import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import {
	countryFlag,
	fetchCrawlers,
	fetchFunnel,
	fetchVisitors,
	isSubscriptionInactive,
	LegacyApiError,
	updateVisitor,
} from "@/lib/legacy/api";
import type {
	CrawlerSlot,
	CrawlersResponse,
	SiteDashboard,
	VisitorJourney,
} from "@/lib/legacy/api";
import { parsePlan, planLabel } from "@/lib/legacy/billing";
import type { PlanTier } from "@/lib/legacy/billing";

import { hostOf, journeyChip, profileToVisitor } from "./dashboard-mapping";
import { agoLabel, fmt, money, pointLabel, visitorAvatar, visitorName } from "./data";
import type { Point, RangeKey } from "./data";
import { GrowthLocked } from "./growth-locked";
import { EmptyBlock, ErrorBlock, PanelState } from "./panel-state";
import { CountBarRow, FunnelChart, Panel, PanelTabs, SortHint, TrafficChart } from "./ui";
import { VisitorSheet } from "./visitors";

const NO_JOURNEYS: VisitorJourney[] = [];

type CrawlerTabKey = "all" | "ai_answers" | "indexing" | "training";

const CRAWLER_TABS: readonly {
	readonly key: CrawlerTabKey;
	readonly label: MessageKey;
}[] = [
	{ key: "all", label: "crawl.all" },
	{ key: "ai_answers", label: "crawl.ai_answers" },
	{ key: "indexing", label: "crawl.indexing" },
	{ key: "training", label: "crawl.training" },
];

const CRAWLER_DOT: Record<CrawlersResponse["bots"][number]["category"], string> = {
	ai_answers: "bg-(--violet)",
	indexing: "bg-sky-500",
	training: "bg-(--money)",
	other: "bg-muted-foreground/50",
};

const slotValue = (slot: CrawlerSlot, tab: CrawlerTabKey): number =>
	tab === "all" ? slot.ai_answers + slot.indexing + slot.training + slot.other : slot[tab];

/**
 * AI-crawler traffic (ChatGPT, Claude, Gemini, …) bucketed by purpose.
 * Source: crawler_hits — bots the tracker recognizes but excludes from human
 * analytics. Note: pure HTML fetchers never run the tracker script, so this
 * sees JS-executing bots (agents, headless browsers, prefetchers).
 */
export const CrawlersPanel = ({ siteId, rangeKey }: { siteId: string; rangeKey: RangeKey }) => {
	const tr = useT();
	const [crawlerTab, setCrawlerTab] = useState<CrawlerTabKey>("all");
	const crawlersQ = useQuery({
		enabled: Boolean(siteId),
		meta: { silent: true },
		queryFn: () => fetchCrawlers(siteId, rangeKey),
		queryKey: ["legacy", "crawlers", siteId, rangeKey],
		retry: false,
		staleTime: 60_000,
	});

	const data = crawlersQ.data;
	const hourly = rangeKey === "24h";
	const points: Point[] = useMemo(
		() =>
			(data?.series ?? []).map((slot) => ({
				...pointLabel(slot.date, hourly),
				date: slot.date,
				current: slotValue(slot, crawlerTab),
			})),
		[crawlerTab, data, hourly],
	);

	const botRows = useMemo(() => {
		const bots = (data?.bots ?? []).filter(
			(b) => crawlerTab === "all" || b.category === crawlerTab,
		);
		const top = Math.max(1, ...bots.map((b) => b.count));
		return bots.map((b) => ({ ...b, share: (b.count / top) * 100 }));
	}, [crawlerTab, data]);

	const tabLabel = (tab: (typeof CRAWLER_TABS)[number]): string => {
		if (!data) {
			return tr(tab.label);
		}
		const n = tab.key === "all" ? data.totals.all : data.totals[tab.key];
		return `${tr(tab.label)} ${fmt(n)}`;
	};

	// Zero hits is the common case: a one-line strip instead of a full panel
	// of dead space. The full chart only mounts when there is something to plot.
	if (crawlersQ.error && !data) {
		return (
			<Panel title={tr("dash.crawlers.title")}>
				<ErrorBlock
					error={crawlersQ.error}
					onRetry={() => void crawlersQ.refetch()}
					retrying={crawlersQ.isFetching}
				/>
			</Panel>
		);
	}
	if (crawlersQ.isLoading || (data?.totals.all ?? 0) === 0) {
		const note = tr(crawlersQ.isLoading ? "dash.crawlers.checking" : "dash.crawlers.none");
		return (
			<section className="bg-card ring-foreground/10 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-2xl px-3 py-2.5 ring-1">
				<h2 className="text-sm font-semibold">{tr("dash.crawlers.title")}</h2>
				<p className="text-muted-foreground text-[13px]" aria-live="polite">
					{note} <span className="hidden sm:inline">{tr("dash.crawlers.about")}</span>
				</p>
			</section>
		);
	}

	return (
		<Panel
			title={tr("dash.crawlers.title")}
			hint={data ? tr("crawl.hits", { n: fmt(data.totals.all) }) : undefined}
		>
			<div className="mb-1.5 flex flex-wrap items-center gap-2">
				<PanelTabs
					value={crawlerTab}
					onChange={setCrawlerTab}
					label={tr("dash.crawlers.title")}
					tabs={CRAWLER_TABS.map((tab) => ({ key: tab.key, label: tabLabel(tab) }))}
				/>
			</div>
			<TrafficChart points={points} />
			<div className="grid gap-1">
				{botRows.map((b) => (
					<CountBarRow
						key={`${b.bot}-${b.category}`}
						glyph={
							<span
								className={`size-2 shrink-0 rounded-full ${CRAWLER_DOT[b.category]}`}
								aria-hidden
							/>
						}
						label={b.bot}
						value={fmt(b.count)}
						share={b.share}
					/>
				))}
			</div>
		</Panel>
	);
};

/** Rows kept in memory; about ten are visible, the rest scroll. */
export const LIVE_FEED_MAX = 30;
/** Above this many rows the list scrolls and fades at the bottom edge. */
const LIVE_FEED_VISIBLE = 10;

export interface LiveFeedItem {
	/** Event id from the stream; unique per event, so it is the React key. */
	key: string;
	flag: string;
	path: string;
	/** City when the event carries one; the stream has no referrer. */
	place: string | null;
	/** ISO timestamp of the event itself, not when the browser received it. */
	at: string;
}

export const LivePanel = ({
	domain,
	online,
	feed,
}: {
	domain: string | undefined;
	online: number | null;
	feed: LiveFeedItem[];
}) => {
	const tr = useT();
	const scrolls = feed.length > LIVE_FEED_VISIBLE;
	return (
		<Panel title={tr("live.title")} hint={tr("dash.live.hint")}>
			<p className="mb-1.5 flex items-center gap-2 text-[13px]">
				<span className="size-2 shrink-0 rounded-full bg-(--up)" aria-hidden />
				<span className="tabular-nums">
					{online === null
						? tr("dash.live.connecting")
						: tr("dash.live.online", { count: fmt(online), domain: domain ?? "" })}
				</span>
			</p>
			{feed.length === 0 ? (
				<EmptyBlock>{tr("dash.live.empty")}</EmptyBlock>
			) : (
				<section
					aria-label={tr("dash.live.hint")}
					// Focusable so keyboard users can scroll the capped list.
					tabIndex={scrolls ? 0 : undefined}
					className={
						scrolls
							? "focus-visible:outline-ring max-h-[340px] overflow-y-auto overscroll-contain rounded-md pb-6 outline-offset-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)] focus-visible:outline-2"
							: undefined
					}
				>
					<ul>
						{feed.map((v) => (
							<li
								key={v.key}
								className="border-border/60 flex h-[34px] items-center gap-2.5 border-t text-[13px] first:border-t-0"
							>
								<span className="w-5 shrink-0 text-center" aria-hidden>
									{v.flag || "🌐"}
								</span>
								<span className="min-w-0 flex-1 truncate">{v.path}</span>
								{v.place ? (
									<span className="text-muted-foreground hidden max-w-28 truncate text-xs sm:block">
										{v.place}
									</span>
								) : null}
								<time
									dateTime={v.at}
									className="text-muted-foreground shrink-0 text-end text-xs whitespace-nowrap tabular-nums"
								>
									{agoLabel(v.at)}
								</time>
							</li>
						))}
					</ul>
				</section>
			)}
		</Panel>
	);
};

const EXPLORE_BOX = "max-h-[420px] overflow-y-auto";

export const ExplorePanel = ({
	siteId,
	dash,
	loading,
	error,
	onRetry,
}: {
	siteId: string;
	dash: SiteDashboard | undefined;
	loading: boolean;
	error: unknown;
	onRetry: () => void;
}) => {
	const tr = useT();
	const [exploreTab, setExploreTab] = useState<"users" | "journeys">("users");
	const [visitorRowId, setVisitorRowId] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const visitorsQ = useQuery({
		enabled: Boolean(siteId),
		meta: { silent: true },
		queryFn: () => fetchVisitors(siteId),
		queryKey: ["legacy", "visitors", siteId],
		retry: false,
		staleTime: 30_000,
	});

	const saveVisitor = useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: { tags: string[]; note: string } }) =>
			updateVisitor(id, {
				notes: patch.note,
				tags: JSON.stringify(patch.tags),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["legacy", "visitors"] });
		},
	});

	const journeys = dash?.journeys ?? NO_JOURNEYS;
	// "recent" keeps the API order (newest first); "events" ranks by the
	// non-heartbeat event count so it's obvious which rows are worth opening.
	const [exploreSort, setExploreSort] = useState<"recent" | "events">("recent");
	const visitors = useMemo(
		() =>
			(visitorsQ.data ?? [])
				.map((p) => profileToVisitor(p, journeys, dash?.currency))
				.toSorted((a, b) => (exploreSort === "events" ? b.events.length - a.events.length : 0)),
		[visitorsQ.data, journeys, exploreSort, dash?.currency],
	);
	const sortedJourneys = useMemo(
		() =>
			exploreSort === "events"
				? journeys
						.map((j) => ({
							j,
							count: j.steps.filter((s) => s.event_type !== "custom" || s.name !== "heartbeat")
								.length,
						}))
						.toSorted((a, b) => b.count - a.count)
						.map(({ j }) => j)
				: journeys,
		[journeys, exploreSort],
	);
	const activeVisitor = visitorRowId ? (visitors.find((v) => v.id === visitorRowId) ?? null) : null;

	return (
		<div className="md:col-span-2">
			<Panel
				title={tr("explore.title")}
				hint={
					<SortHint
						label={tr(exploreSort === "recent" ? "explore.sortRecent" : "explore.sortEvents")}
						onToggle={() => setExploreSort(exploreSort === "recent" ? "events" : "recent")}
					/>
				}
			>
				<div className="mb-2">
					<PanelTabs
						value={exploreTab}
						onChange={setExploreTab}
						label={tr("explore.title")}
						tabs={[
							{ key: "users", label: tr("explore.users") },
							{ key: "journeys", label: tr("explore.journeys") },
						]}
					/>
				</div>
				{exploreTab === "users" ? (
					<PanelState
						loading={visitorsQ.isLoading}
						error={visitorsQ.error}
						onRetry={() => void visitorsQ.refetch()}
						retrying={visitorsQ.isFetching}
						hasData={visitors.length > 0}
						emptyText={tr("dash.users.empty")}
					>
						<div>
							<div className="text-muted-foreground border-border/60 grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b pb-1.5 text-xs sm:grid-cols-[minmax(0,1fr)_130px_80px_170px]">
								<span>{tr("explore.visitor")}</span>
								<span className="hidden sm:block">{tr("explore.source")}</span>
								<span className="hidden text-end sm:block">{tr("explore.spent")}</span>
								<span className="text-end">{tr("explore.lastSeen")}</span>
							</div>
							<div className={EXPLORE_BOX}>
								{visitors.map((v) => (
									<button
										key={v.id}
										type="button"
										onClick={() => setVisitorRowId(v.id)}
										className="border-border/60 hover:bg-foreground/[0.03] focus-visible:outline-ring pointer-coarse:min-h-14 -mx-1 grid w-[calc(100%+8px)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-1 py-2 text-start text-[13px] outline-offset-2 last:border-b-0 focus-visible:outline-2 sm:grid-cols-[minmax(0,1fr)_130px_80px_170px]"
									>
										<span className="flex min-w-0 items-center gap-2.5">
											<img
												src={visitorAvatar(v)}
												alt=""
												loading="lazy"
												className="ring-foreground/10 bg-card size-9 shrink-0 rounded-full ring-1"
											/>
											<span className="min-w-0">
												<span className="block truncate font-medium">
													{visitorName(v)}
													<span className="bg-muted text-muted-foreground ms-1.5 rounded px-1 py-0.5 text-xs font-normal tabular-nums">
														{tr("explore.events", {
															n: v.events.length,
															count: fmt(v.events.length),
														})}
													</span>
												</span>
												<span className="text-muted-foreground flex items-center gap-1 text-xs">
													<span aria-hidden>{v.flag}</span>
													{[v.country, v.device, v.os, v.browser]
														.filter((part): part is string => Boolean(part))
														.join(" · ") || tr("explore.unknown")}
												</span>
											</span>
										</span>
										<span className="text-muted-foreground hidden truncate text-xs sm:block">
											{v.source}
										</span>
										<span className="hidden text-end text-xs tabular-nums sm:block">
											{v.spent ?? "–"}
										</span>
										<span className="text-end">
											<span className="block text-xs">{v.lastSeen}</span>
											<span className="mt-1 flex justify-end gap-1" aria-hidden>
												{v.activity.map((a, i) => (
													<span
														key={i}
														className={`size-2 rounded-full ${a ? "bg-(--chart)" : "bg-muted-foreground/25"}`}
													/>
												))}
											</span>
										</span>
									</button>
								))}
							</div>
						</div>
					</PanelState>
				) : (
					<PanelState
						loading={loading}
						error={error}
						onRetry={onRetry}
						hasData={journeys.length > 0}
						emptyText={tr("explore.journeysEmpty")}
					>
						<div className={EXPLORE_BOX}>
							{sortedJourneys.slice(0, 20).map((j) => {
								const realSteps = j.steps.filter(
									(s) => s.event_type !== "custom" || s.name !== "heartbeat",
								);
								const chips = realSteps.slice(0, 6).map((s) => journeyChip(s, dash?.currency));
								return (
									<div
										key={j.session_id}
										className="border-border/60 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t py-2 text-[13px] first:border-t-0"
									>
										<span aria-hidden>{countryFlag(j.country) || "🌐"}</span>
										<span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs">
											{j.utm_source || hostOf(j.referrer) || tr("explore.direct")}
										</span>
										<span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
											{chips.map((s, i) => (
												<span key={`${s}-${i}`} className="flex items-center gap-1">
													{i > 0 ? (
														<ArrowRight className="text-muted-foreground/60 size-3" aria-hidden />
													) : null}
													<span className="bg-muted/70 rounded-full px-2 py-0.5 text-xs">{s}</span>
												</span>
											))}
										</span>
										<span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs tabular-nums">
											{tr("explore.events", { n: realSteps.length, count: fmt(realSteps.length) })}
										</span>
										{j.visitor_name ? (
											<span className="rounded-full bg-(--chart)/10 px-2 py-0.5 text-xs text-(--chart)">
												{j.visitor_name}
											</span>
										) : null}
										<span className="text-muted-foreground text-xs tabular-nums">
											{agoLabel(j.started_at)}
										</span>
										{j.total_revenue > 0 ? (
											<span className="inline-flex items-center gap-1 rounded-full bg-(--money)/12 px-2 py-0.5 text-xs text-(--money) tabular-nums">
												<Check className="size-3" aria-hidden />
												{money(j.total_revenue, dash?.currency)}
											</span>
										) : (
											<span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
												{tr("explore.noSale")}
											</span>
										)}
									</div>
								);
							})}
						</div>
					</PanelState>
				)}
			</Panel>

			{activeVisitor ? (
				<VisitorSheet
					key={activeVisitor.id}
					visitor={activeVisitor}
					onClose={() => setVisitorRowId(null)}
					onSave={async (patch) => {
						await saveVisitor.mutateAsync({ id: activeVisitor.id, patch });
					}}
				/>
			) : null}
		</div>
	);
};

/**
 * Plan that unlocks funnels when the funnel read is plan-gated (403);
 * Starter unless the API names another tier.
 */
export const funnelLockPlan = (error: unknown): PlanTier | null => {
	if (!(error instanceof LegacyApiError) || error.status !== 403) {
		return null;
	}
	return parsePlan(error.body?.required_plan) ?? "starter";
};

export const FunnelSection = ({
	siteId,
	rangeKey,
	filterStr,
	onUpgrade,
}: {
	siteId: string;
	rangeKey: RangeKey;
	filterStr: string;
	onUpgrade: (plan: PlanTier) => void;
}) => {
	const tr = useT();
	const [funnelPath, setFunnelPath] = useState("");
	const funnelQ = useQuery({
		enabled: Boolean(siteId),
		// Plan-locked accounts get the inline lock below, not a toast per load.
		meta: { silent: true },
		queryFn: () => fetchFunnel(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "funnel", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const lockedPlan = funnelLockPlan(funnelQ.error);
	const funnel = funnelQ.data;
	const funnelPage = funnel?.pages.find((p) => p.path === funnelPath) ?? funnel?.pages[0];
	const funnelSteps = funnelPage?.steps ?? funnel?.steps ?? [];
	const funnelRate = funnelPage?.conversionRate ?? funnel?.conversionRate ?? 0;
	const activePath = funnelPage?.path ?? "";
	const inactive = isSubscriptionInactive(funnelQ.error);

	return (
		<Panel title={tr("funnel.title")} hint={tr("funnel.hint")}>
			{funnel?.pages.length ? (
				<div className="mb-2 overflow-x-auto">
					<PanelTabs
						value={activePath}
						onChange={setFunnelPath}
						label={tr("funnel.pages")}
						tabs={funnel.pages.map((p) => ({ key: p.path, label: p.path }))}
					/>
				</div>
			) : null}
			{funnelSteps.length > 0 && !funnelQ.error ? (
				<p className="mb-1 text-[13px] font-semibold tabular-nums sm:hidden">
					{tr("dash.funnel.rate", { rate: funnelRate })}
				</p>
			) : null}
			{lockedPlan ? (
				<GrowthLocked
					feature="Funnels"
					plan={planLabel(lockedPlan)}
					onUpgrade={() => onUpgrade(lockedPlan)}
				/>
			) : (
				<PanelState
					loading={funnelQ.isLoading}
					error={inactive ? null : funnelQ.error}
					onRetry={() => void funnelQ.refetch()}
					retrying={funnelQ.isFetching}
					hasData={funnelSteps.length > 0 || inactive}
					emptyText={tr("funnel.empty")}
				>
					{inactive ? (
						<EmptyBlock>{tr("funnel.pickPlan")}</EmptyBlock>
					) : (
						<FunnelChart rate={funnelRate} steps={funnelSteps} />
					)}
				</PanelState>
			)}
		</Panel>
	);
};

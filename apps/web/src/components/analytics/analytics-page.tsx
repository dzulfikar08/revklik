import { getLegacyUser } from "@/lib/legacy/api";
import { AdminView } from "./admin-view";
import { BrandMark } from "@revklik/ui/components/brand-mark";
import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	Code2,
	ShieldCheck,
	CreditCard,
	Download,
	FileText,
	Globe,
	Home,
	Plus,
	Share2,
	Settings,
	Webhook,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
	CITY_COORDS,
	connectSSE,
	countryFlag,
	encodeFilterString,
	fetchCampaigns,
	fetchCrawlers,
	fetchDashboard,
	fetchFunnel,
	fetchGeo,
	fetchSites,
	fetchVisitors,
	isSubscriptionInactive,
	LegacyApiError,
	updateVisitor,
} from "@/lib/legacy/api";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { openBilling } from "@/lib/billing-nav";
import { isSelfHosted } from "@/lib/instance-config";
import { parsePlan, planLabel } from "@/lib/legacy/billing";
import type { PlanTier } from "@/lib/legacy/billing";

import { GrowthLocked } from "./growth-locked";
import { AccountNotices } from "./account-notices";
import type {
	CampaignPerformance,
	CompareKey,
	CrawlerSlot,
	CrawlersResponse,
	FilterOperator,
	GeoRow,
	JourneyStep,
	LegacyFilter,
	SiteDashboard,
	VisitorJourney,
	VisitorProfile,
} from "@/lib/legacy/api";
import { exportLegacyFile } from "@/lib/legacy/sites";
import { fetchAppStoreMetrics } from "@/lib/legacy/appstoreconnect";
import type { LegacyAnnotation } from "@/lib/legacy/analytics-settings";

import { AnnotationsControl } from "./annotations";
import { BillingView } from "./billing-view";
import {
	FILTER_DIMS,
	FILTER_OPS,
	RANGES,
	agoLabel,
	duration,
	fmt,
	fmtC,
	deltaBadge,
	money,
	pointLabel,
	visitorAvatar,
	visitorName,
} from "./data";
import type { CountRow, Point, RangeKey, Visitor, VisitorEvent } from "./data";
import { IntegrationsView } from "./integrations-view";
import { SettingsView } from "./settings";
import { fetchVisitorProfile, type VisitorProfileResult } from "@/lib/legacy/growth";
import { SitesView } from "./sites-view";
import { siteHasEvents, SnippetModal } from "./snippet-modal";
import { AiInsightsPanel } from "./ai-insights";
import { HeatmapPanel } from "./heatmap";
import { PredictionsPanel } from "./predictions";
import { RecordingsPanel } from "./recordings";
import { SegmentControls } from "./segments";
import { ShareWidgetTokensView } from "./share-widget-tokens";
import {
	CountBarRow,
	FunnelChart,
	GlobePanel,
	Panel,
	PanelTabs,
	PlatformGlyph,
	SkeletonRows,
	SortHint,
	StatTile,
	TrafficChart,
} from "./ui";
import { UpgradeLock } from "./upgrade-lock";
import type { ViewKey } from "./views";
import { VisitorSheet } from "./visitors";

type LocationTabKey = "country" | "region" | "city" | "globe";
type PageTabKey = "pages" | "entry" | "exit";
type SourceTabKey = "referrer" | "channel";
type PlatformTabKey = "browser" | "os" | "device";
type RevenueTabKey = "source" | "country" | "method" | "campaign" | "appstore";

const NAV_TABS = [
	{ Icon: Home, key: "home" as const, label: "Home" },
	{ Icon: Settings, key: "settings" as const, label: "Settings" },
	{ Icon: Share2, key: "share" as const, label: "Share" },
	{ Icon: CreditCard, key: "billing" as const, label: "Billing" },
	{ Icon: ShieldCheck, key: "admin" as const, label: "Admin" },
	{ Icon: Webhook, key: "integrations" as const, label: "Integrations" },
];

const NO_ROWS: GeoRow[] = [];
const NO_JOURNEYS: VisitorJourney[] = [];

const NavTabs = ({
	view,
	onView,
	className,
}: {
	view: ViewKey;
	onView: (v: ViewKey) => void;
	className?: string;
}) => {
	const isAdmin = getLegacyUser()?.role === "super_admin";
	const selfHosted = isSelfHosted();
	const tabs = NAV_TABS.filter(
		(t) => (t.key !== "admin" || isAdmin) && (t.key !== "billing" || !selfHosted),
	);
	return (
		<nav
			role="tablist"
			aria-label="Sections"
			className={`bg-muted/70 flex max-w-full overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible ${
				className ?? ""
			}`}
		>
			{tabs.map(({ key, label, Icon }) => (
				<button
					key={key}
					type="button"
					role="tab"
					aria-selected={view === key}
					onClick={() => onView(key)}
					className={`focus-visible:outline-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium outline-offset-2 focus-visible:outline-2 ${
						view === key
							? "bg-card text-foreground ring-foreground/10 ring-1"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<Icon className="size-3.5" aria-hidden />
					{label}
				</button>
			))}
		</nav>
	);
};

/* -------------------------------- mapping ---------------------------------- */

const hostOf = (referrer: string | null | undefined): string | null => {
	if (!referrer) {
		return null;
	}
	try {
		return new URL(referrer).host.replace(/^www\./u, "");
	} catch {
		return referrer;
	}
};

const parseTags = (raw: string | null): string[] => {
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.map((t) => `${t}`);
		}
	} catch {
		/* plain string */
	}
	return raw
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
};

const parseProps = (raw: string | null): [string, string][] => {
	if (!raw) {
		return [];
	}
	try {
		const obj = JSON.parse(raw) as Record<string, unknown>;
		return Object.entries(obj).map(([k, v]) => [k, `${v}`]);
	} catch {
		return [];
	}
};

/** `currency` is the dashboard response's ISO code; USD when absent. */
export const stepToEvent = (s: JourneyStep, currency?: string): VisitorEvent | null => {
	if (s.event_type === "pageview") {
		return { kind: "view", page: s.path, time: s.timestamp };
	}
	if (s.event_type === "conversion") {
		const p = parseProps(s.props);
		return {
			event: s.name ?? "conversion",
			kind: "conversion",
			props: p.length ? p : undefined,
			revenue: s.revenue ? money(s.revenue, currency) : undefined,
			time: s.timestamp,
		};
	}
	if (s.event_type !== "custom") {
		return { event: s.name ?? s.event_type, kind: "event", time: s.timestamp };
	}
	const p = parseProps(s.props);
	const kv = Object.fromEntries(p);
	const withProps = p.length ? p : undefined;
	if (s.name === "heartbeat") {
		return null;
	}
	if (s.name === "scroll") {
		return {
			kind: "scroll",
			milestone: Number(kv["depth"] ?? 0) || null,
			props: withProps,
			time: s.timestamp,
		};
	}
	if (s.name === "scroll_section") {
		return {
			kind: "section",
			props: withProps,
			section: kv["section_id"] ?? kv["section"] ?? s.path,
			time: s.timestamp,
		};
	}
	if (s.name === "click") {
		return {
			click: kv["text"] ?? kv["target"] ?? s.path,
			kind: "click",
			props: withProps,
			time: s.timestamp,
		};
	}
	return {
		event: s.name ?? "custom",
		kind: "event",
		props: withProps,
		time: s.timestamp,
	};
};

export const profileToVisitor = (
	p: VisitorProfile,
	journeys: VisitorJourney[],
	currency?: string,
): Visitor => {
	const mine = journeys
		.filter((j) => j.visitor_id === p.visitor_id)
		.toSorted((a, b) => a.started_at.localeCompare(b.started_at));
	const events = mine
		.flatMap((j) => j.steps.map((s) => stepToEvent(s, currency)))
		.filter((e): e is VisitorEvent => e !== null)
		.toSorted((a, b) => a.time.localeCompare(b.time));
	const source = mine[0]?.utm_source ?? hostOf(mine[0]?.referrer) ?? "direct";
	const now = Date.now();
	const activity = Array.from({ length: 7 }, (_, i) => {
		const dayStart = new Date(now - (6 - i) * 86_400_000);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = dayStart.getTime() + 86_400_000;
		return mine.some((j) => {
			const t = new Date(j.started_at).getTime();
			return t >= dayStart.getTime() && t < dayEnd;
		})
			? 1
			: 0;
	});
	return {
		activity,
		browser: p.browser,
		city: p.city,
		country: p.country,
		customer: p.total_revenue > 0,
		device: p.device_type,
		email: p.email,
		events,
		flag: countryFlag(p.country),
		id: p.id,
		lastSeen: agoLabel(p.last_seen),
		name: p.name,
		note: p.notes ?? "",
		os: p.os,
		params: [],
		source,
		spent: p.total_revenue > 0 ? money(p.total_revenue, currency) : null,
		tags: parseTags(p.tags),
		visitorId: p.visitor_id,
	};
};

export const aggregateGeo = (rows: GeoRow[], keyOf: (r: GeoRow) => string | null): CountRow[] => {
	const map = new Map<string, number>();
	for (const r of rows) {
		const key = keyOf(r);
		if (!key) {
			continue;
		}
		map.set(key, (map.get(key) ?? 0) + r.visitors);
	}
	return [...map.entries()]
		.toSorted((a, b) => b[1] - a[1])
		.map(([label, value]) => ({
			flag: countryFlag(label) || undefined,
			label,
			value,
		}));
};

const deviceGlyph = (device: string) => {
	const d = device.toLowerCase();
	if (d.includes("mobile") || d.includes("phone")) {
		return { device: "mobile" as const };
	}
	if (d.includes("tablet")) {
		return { device: "tablet" as const };
	}
	return { device: "desktop" as const };
};

const NEUTRAL_GLYPH = { bg: "oklch(0.34 0.02 260)", shape: "square" as const };

const journeyChip = (s: JourneyStep, currency?: string): string => {
	if (s.event_type === "pageview") {
		return s.path || "/";
	}
	if (s.event_type === "conversion") {
		return `${s.name ?? "purchase"} ${money(s.revenue ?? 0, currency)}`;
	}
	return s.name ?? s.event_type;
};

/* ------------------------------ panel helpers ------------------------------ */

const PanelMsg = ({ children }: { children: ReactNode }) => (
	<p className="text-muted-foreground py-6 text-center text-xs">{children}</p>
);

const PanelBody = ({
	loading,
	hasData,
	emptyText,
	children,
	skeleton,
}: {
	loading: boolean;
	hasData: boolean;
	emptyText: string;
	children: ReactNode;
	/** Loading placeholder; defaults to bar-row skeletons. */
	skeleton?: ReactNode;
}) => {
	if (loading) {
		return skeleton ?? <SkeletonRows />;
	}
	if (!hasData) {
		return <PanelMsg>{emptyText}</PanelMsg>;
	}
	return children;
};

interface DashProps {
	dash: SiteDashboard | undefined;
	loading: boolean;
}

/* --------------------------------- panels ---------------------------------- */

const PAGES_HINT: Record<PageTabKey, string> = {
	entry: "sessions",
	exit: "exits",
	pages: "views",
};

type CrawlerTabKey = "all" | "ai_answers" | "indexing" | "training";

const CRAWLER_TABS: readonly {
	readonly key: CrawlerTabKey;
	readonly label: string;
}[] = [
	{ key: "all", label: "All" },
	{ key: "ai_answers", label: "AI answers" },
	{ key: "indexing", label: "Indexing" },
	{ key: "training", label: "Training" },
];

const CRAWLER_DOT: Record<CrawlersResponse["bots"][number]["category"], string> = {
	ai_answers: "bg-violet-400",
	indexing: "bg-sky-400",
	training: "bg-amber-400",
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
const CrawlersPanel = ({ siteId, rangeKey }: { siteId: string; rangeKey: RangeKey }) => {
	const tr = useT();
	const [crawlerTab, setCrawlerTab] = useState<CrawlerTabKey>("all");
	const crawlersQ = useQuery({
		enabled: Boolean(siteId),
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

	const tabLabel = (key: CrawlerTabKey): string => {
		if (!data) {
			return CRAWLER_TABS.find((t) => t.key === key)?.label ?? key;
		}
		const n = key === "all" ? data.totals.all : data.totals[key];
		return `${CRAWLER_TABS.find((t) => t.key === key)?.label ?? key} ${fmt(n)}`;
	};

	// Zero hits is the common case: a one-line strip instead of a full panel
	// of dead space. The full chart only mounts when there is something to plot.
	if (crawlersQ.isLoading || crawlersQ.error || (data?.totals.all ?? 0) === 0) {
		let note = tr("dash.crawlers.none");
		if (crawlersQ.isLoading) {
			note = tr("dash.crawlers.checking");
		} else if (crawlersQ.error) {
			note = tr("dash.crawlers.error");
		}
		return (
			<section className="bg-card ring-foreground/10 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-2xl px-3 py-2.5 ring-1">
				<h2 className="text-sm font-semibold">{tr("dash.crawlers.title")}</h2>
				<p className="text-muted-foreground text-xs" aria-live="polite">
					{note} <span className="hidden sm:inline">{tr("dash.crawlers.about")}</span>
				</p>
			</section>
		);
	}

	return (
		<Panel title="AI crawlers" hint={data ? `${fmt(data.totals.all)} hits` : undefined}>
			<div className="mb-1.5 flex flex-wrap items-center gap-2">
				<PanelTabs
					value={crawlerTab}
					onChange={setCrawlerTab}
					tabs={CRAWLER_TABS.map((t) => ({ ...t, label: tabLabel(t.key) }))}
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

const PagesPanel = ({
	dash,
	loading,
	onSelectPath,
}: DashProps & { onSelectPath?: (path: string) => void }) => {
	const [pageTab, setPageTab] = useState<PageTabKey>("pages");
	const [pageSort, setPageSort] = useState<"desc" | "asc">("desc");
	const rows: CountRow[] = useMemo(() => {
		const unsorted: CountRow[] =
			pageTab === "entry"
				? (dash?.entryPagesRevenue ?? []).map((p) => ({
						label: p.path,
						value: p.sessions,
					}))
				: pageTab === "exit"
					? (dash?.exitPages ?? []).map((p) => ({
							label: p.path,
							value: p.exits,
						}))
					: (dash?.topPages ?? []).map((p) => ({
							label: p.path,
							value: p.pageviews,
						}));
		return unsorted.toSorted((a, b) =>
			pageSort === "desc" ? b.value - a.value : a.value - b.value,
		);
	}, [dash, pageTab, pageSort]);
	const total = rows.reduce((acc, r) => acc + r.value, 0);

	return (
		<Panel
			tabs={
				<PanelTabs
					value={pageTab}
					onChange={setPageTab}
					tabs={[
						{ key: "pages", label: "Pages" },
						{ key: "entry", label: "Entry" },
						{ key: "exit", label: "Exit" },
					]}
				/>
			}
			hint={
				<SortHint
					dir={pageSort}
					label={PAGES_HINT[pageTab]}
					onToggle={() => setPageSort(pageSort === "desc" ? "asc" : "desc")}
				/>
			}
		>
			<PanelBody
				loading={loading}
				hasData={rows.length > 0}
				emptyText="No pageviews in this range."
			>
				<div className="grid max-h-[420px] gap-1 overflow-y-auto">
					{rows.map((p) => (
						<button
							key={p.label}
							type="button"
							onClick={() => onSelectPath?.(p.label)}
							title="Show journeys for this page"
							className="focus-visible:outline-ring block w-full cursor-pointer rounded-lg text-left outline-offset-2 focus-visible:outline-2"
						>
							<CountBarRow
								glyph={<FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />}
								label={p.label}
								value={fmtC(p.value)}
								share={(p.value / total) * 100}
							/>
						</button>
					))}
				</div>
			</PanelBody>
		</Panel>
	);
};
const SourcesPanel = ({ dash, loading }: DashProps) => {
	const [sourceTab, setSourceTab] = useState<SourceTabKey>("referrer");
	const [sourceSort, setSourceSort] = useState<"desc" | "asc">("desc");
	const rows: CountRow[] = useMemo(() => {
		const unsorted: CountRow[] =
			sourceTab === "channel"
				? (dash?.channels ?? []).map((c) => ({
						label: c.channel,
						value: c.visitors,
					}))
				: (dash?.sources ?? []).map((s) => ({
						label: s.source,
						value: s.visitors,
					}));
		return unsorted.toSorted((a, b) =>
			sourceSort === "desc" ? b.value - a.value : a.value - b.value,
		);
	}, [dash, sourceTab, sourceSort]);
	const total = rows.reduce((acc, r) => acc + r.value, 0);
	return (
		<Panel
			tabs={
				<PanelTabs
					value={sourceTab}
					onChange={setSourceTab}
					tabs={[
						{ key: "referrer", label: "Referrer" },
						{ key: "channel", label: "Channel" },
					]}
				/>
			}
			hint={
				<SortHint
					dir={sourceSort}
					label="visitors"
					onToggle={() => setSourceSort(sourceSort === "desc" ? "asc" : "desc")}
				/>
			}
		>
			<PanelBody loading={loading} hasData={rows.length > 0} emptyText="No visits in this range.">
				<div className="grid max-h-[420px] gap-1 overflow-y-auto">
					{rows.map((s) => (
						<CountBarRow
							key={s.label}
							glyph={<Globe className="text-muted-foreground size-4 shrink-0" aria-hidden />}
							label={s.label}
							value={fmtC(s.value)}
							share={(s.value / total) * 100}
						/>
					))}
				</div>
			</PanelBody>
		</Panel>
	);
};

const LocationPanel = ({
	siteId,
	rangeKey,
	filterStr,
}: {
	siteId: string;
	rangeKey: RangeKey;
	filterStr: string;
}) => {
	const tr = useT();
	const [locationTab, setLocationTab] = useState<LocationTabKey>("country");
	const [locationSort, setLocationSort] = useState<"desc" | "asc">("desc");
	const geoQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchGeo(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "geo", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const geoRows = geoQ.data ?? NO_ROWS;
	const rows: CountRow[] = useMemo(() => {
		const unsorted: CountRow[] =
			locationTab === "region"
				? aggregateGeo(geoRows, (r) => r.region)
				: locationTab === "city"
					? aggregateGeo(geoRows, (r) => r.city)
					: aggregateGeo(geoRows, (r) => r.country);
		return unsorted.toSorted((a, b) =>
			locationSort === "desc" ? b.value - a.value : a.value - b.value,
		);
	}, [geoRows, locationTab, locationSort]);
	const total = rows.reduce((acc, r) => acc + r.value, 0);
	const globeMarkers = useMemo(
		() =>
			geoRows
				.filter((r) => r.city && CITY_COORDS[r.city])
				.slice(0, 8)
				.map((r) => ({
					city: r.city as string,
					location: CITY_COORDS[r.city as string],
				})),
		[geoRows],
	);
	const renderBody = () => {
		if (locationTab === "globe") {
			if (geoQ.isLoading) {
				return (
					<div
						className="bg-muted/40 h-72 animate-pulse rounded-lg"
						aria-label={tr("dash.loadingGlobe")}
						role="status"
					/>
				);
			}
			if (!globeMarkers.length) {
				return <PanelMsg>No geolocated cities in this range.</PanelMsg>;
			}
			return <GlobePanel markers={globeMarkers} />;
		}
		return (
			<PanelBody
				loading={geoQ.isLoading}
				hasData={rows.length > 0}
				emptyText="No located visitors in this range."
			>
				<div className="grid max-h-[420px] gap-1 overflow-y-auto">
					{rows.map((c) => (
						<CountBarRow
							key={c.label}
							glyph={
								<span className="text-[15px] leading-none" aria-hidden>
									{c.flag ?? "🌐"}
								</span>
							}
							label={c.label}
							value={fmtC(c.value)}
							share={(c.value / total) * 100}
						/>
					))}
				</div>
			</PanelBody>
		);
	};

	return (
		<Panel
			tabs={
				<PanelTabs
					value={locationTab}
					onChange={setLocationTab}
					tabs={[
						{ key: "country", label: "Countries" },
						{ key: "region", label: "Region" },
						{ key: "city", label: "City" },
						{ key: "globe", label: "Globe" },
					]}
				/>
			}
			hint={
				locationTab === "globe" ? undefined : (
					<SortHint
						dir={locationSort}
						label="visitors"
						onToggle={() => setLocationSort(locationSort === "desc" ? "asc" : "desc")}
					/>
				)
			}
		>
			{renderBody()}
		</Panel>
	);
};

/** Platform rows come from the sessions table, not raw events. */
const PLATFORM_EMPTY = {
	browser: "dash.platform.browser",
	device: "dash.platform.device",
	os: "dash.platform.os",
} as const satisfies Record<PlatformTabKey, MessageKey>;

const PlatformPanel = ({ dash, loading }: DashProps) => {
	const tr = useT();
	const [platformTab, setPlatformTab] = useState<PlatformTabKey>("device");
	const [platformDir, setPlatformDir] = useState<"desc" | "asc">("desc");
	const src = useMemo(() => {
		if (platformTab === "browser") {
			return dash?.browsers;
		}
		if (platformTab === "os") {
			return dash?.os;
		}
		return dash?.devices;
	}, [dash, platformTab]);
	const { sorted, total } = useMemo(() => {
		const rows = (src ?? []).map((d) => ({
			glyph: platformTab === "device" ? deviceGlyph(d.device) : NEUTRAL_GLYPH,
			label: d.device,
			value: d.visitors,
		}));
		return {
			sorted: rows.toSorted((a, b) =>
				platformDir === "desc" ? b.value - a.value : a.value - b.value,
			),
			total: rows.reduce((acc, r) => acc + r.value, 0),
		};
	}, [src, platformTab, platformDir]);

	return (
		<Panel
			tabs={
				<PanelTabs
					value={platformTab}
					onChange={setPlatformTab}
					tabs={[
						{ key: "browser", label: "Browser" },
						{ key: "os", label: "OS" },
						{ key: "device", label: "Device" },
					]}
				/>
			}
			hint={
				<SortHint
					dir={platformDir}
					label="Visitors"
					onToggle={() => setPlatformDir(platformDir === "desc" ? "asc" : "desc")}
				/>
			}
		>
			<PanelBody
				loading={loading}
				hasData={sorted.length > 0}
				emptyText={tr(PLATFORM_EMPTY[platformTab])}
			>
				<div className="grid max-h-[420px] gap-1 overflow-y-auto">
					{sorted.map((d) => (
						<CountBarRow
							key={d.label}
							glyph={<PlatformGlyph row={d.glyph} />}
							label={d.label}
							value={fmtC(d.value)}
							share={(d.value / total) * 100}
						/>
					))}
				</div>
			</PanelBody>
		</Panel>
	);
};

const RevenuePanel = ({
	dash,
	loading,
	siteId,
	rangeKey,
	filterStr,
}: DashProps & { siteId: string; rangeKey: RangeKey; filterStr: string }) => {
	const tr = useT();
	const [revenueTab, setRevenueTab] = useState<RevenueTabKey>("source");
	const ascQ = useQuery({
		enabled: Boolean(siteId) && revenueTab === "appstore",
		queryFn: () => fetchAppStoreMetrics(siteId, rangeKey),
		queryKey: ["legacy", "appstore-metrics", siteId, rangeKey],
		// No App Store Connect integration on the site → 404; expected, stay quiet.
		meta: { silent: true },
		retry: false,
		staleTime: 60_000,
	});
	const campaignsQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchCampaigns(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "campaigns", siteId, rangeKey, filterStr],
		// The worker predates this endpoint (404) — fetchCampaigns already
		// degrades that to "no campaigns", so don't also toast it.
		meta: { silent: true },
		retry: false,
		staleTime: 60_000,
	});
	const [revenueSort, setRevenueSort] = useState<"desc" | "asc">("desc");
	const rows: CountRow[] = useMemo(() => {
		const unsorted: CountRow[] =
			revenueTab === "appstore"
				? (ascQ.data?.byCountry ?? []).map((r) => ({
						flag: countryFlag(r.country) || undefined,
						label: r.country,
						value: r.proceeds,
					}))
				: revenueTab === "country"
					? (dash?.revenueByCountry ?? []).map((r) => ({
							flag: countryFlag(r.country) || undefined,
							label: r.country,
							value: r.revenue,
						}))
					: revenueTab === "method"
						? (dash?.revenueByMethod ?? []).map((r) => ({
								label: r.method,
								value: r.revenue,
							}))
						: (dash?.revenueBySource ?? []).map((r) => ({
								label: r.source,
								value: r.revenue,
							}));
		return unsorted.toSorted((a, b) =>
			revenueSort === "desc" ? b.value - a.value : a.value - b.value,
		);
	}, [dash, revenueTab, revenueSort, ascQ.data]);
	const total = rows.reduce((acc, r) => acc + r.value, 0);

	const campaigns = campaignsQ.data ?? [];
	const campaignBody = () => {
		if (campaignsQ.isLoading) {
			return <SkeletonRows rows={4} label={tr("dash.loadingCampaigns")} />;
		}
		if (!campaigns.length) {
			return <PanelMsg>No campaigns recorded.</PanelMsg>;
		}
		return (
			<div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 text-[13px]">
				<span className="text-muted-foreground pb-1 text-xs">Campaign</span>
				<span className="text-muted-foreground pb-1 text-end text-xs">Visitors</span>
				<span className="text-muted-foreground pb-1 text-end text-xs">Revenue</span>
				{campaigns.map((c: CampaignPerformance) => (
					<div
						key={`${c.utm_source}-${c.utm_medium}-${c.utm_campaign}`}
						className="border-border/60 col-span-3 grid grid-cols-subgrid items-center border-t py-1.5"
					>
						<span className="min-w-0">
							<span className="block truncate font-medium">{c.utm_campaign || "(none)"}</span>
							<span className="text-muted-foreground block truncate text-xs">
								{c.utm_source || "—"} · {c.utm_medium || "—"} · {c.conversionRate}% convert
							</span>
						</span>
						<span className="text-end font-mono text-xs tabular-nums">{fmt(c.visitors)}</span>
						<span className="text-end font-mono text-xs text-(--money) tabular-nums">
							{money(c.revenue, dash?.currency)}
						</span>
					</div>
				))}
			</div>
		);
	};

	const moneyBody = () => (
		<PanelBody loading={loading} hasData={rows.length > 0} emptyText="No revenue in this range.">
			<div className="grid max-h-[420px] gap-1 overflow-y-auto">
				{rows.map((r) => (
					<CountBarRow
						key={r.label}
						// A hard-coded "$" glyph contradicted IDR sites; only the
						// country tab has a glyph worth showing (the flag).
						glyph={
							r.flag ? (
								<span className="text-[15px] leading-none" aria-hidden>
									{r.flag}
								</span>
							) : undefined
						}
						label={r.label}
						value={money(r.value, dash?.currency)}
						share={(r.value / total) * 100}
						fill="var(--money)"
					/>
				))}
			</div>
		</PanelBody>
	);
	const ascBody = () => {
		const asc = ascQ.data;
		const hasAsc = Boolean(
			asc && (asc.totals.downloads > 0 || asc.totals.proceeds > 0 || rows.length > 0),
		);
		return (
			<PanelBody
				loading={loading || ascQ.isLoading}
				hasData={hasAsc}
				emptyText={
					asc
						? "No App Store sales in this range."
						: "No App Store Connect data — attach the integration to this site first."
				}
			>
				{asc && (
					<div className="text-muted-foreground mb-2 flex items-center gap-4 px-1 text-xs">
						<span>{fmt(asc.totals.downloads)} downloads</span>
						<span className="font-mono text-(--money)">{money(asc.totals.proceeds)}</span>
						{asc.totals.iap_proceeds > 0 ? (
							<span>· IAP {money(asc.totals.iap_proceeds)}</span>
						) : null}
					</div>
				)}
				<div className="grid max-h-[420px] gap-1 overflow-y-auto">
					{rows.map((r) => (
						<CountBarRow
							key={r.label}
							label={r.label}
							value={money(r.value)}
							share={(r.value / total) * 100}
							fill="var(--money)"
						/>
					))}
				</div>
			</PanelBody>
		);
	};

	return (
		<Panel
			tabs={
				<PanelTabs
					value={revenueTab}
					onChange={setRevenueTab}
					tabs={[
						{ key: "source", label: "Source" },
						{ key: "country", label: "Country" },
						{ key: "method", label: "Method" },
						{ key: "campaign", label: "Campaign" },
						{ key: "appstore", label: "App Store" },
					]}
				/>
			}
			hint={
				<SortHint
					dir={revenueSort}
					label="revenue"
					onToggle={() => setRevenueSort(revenueSort === "desc" ? "asc" : "desc")}
				/>
			}
		>
			{revenueTab === "campaign"
				? campaignBody()
				: revenueTab === "appstore"
					? ascBody()
					: moneyBody()}
		</Panel>
	);
};

/** Rows kept in memory; about ten are visible, the rest scroll. */
const LIVE_FEED_MAX = 30;
/** Above this many rows the list scrolls and fades at the bottom edge. */
const LIVE_FEED_VISIBLE = 10;

interface LiveFeedItem {
	/** Event id from the stream; unique per event, so it is the React key. */
	key: string;
	flag: string;
	path: string;
	/** City when the event carries one; the stream has no referrer. */
	place: string | null;
	/** ISO timestamp of the event itself, not when the browser received it. */
	at: string;
}

const LivePanel = ({
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
		<Panel title="Live" hint={tr("dash.live.hint")}>
			<p className="mb-1.5 flex items-center gap-2 text-[13px]">
				<span className="size-2 shrink-0 rounded-full bg-(--up)" aria-hidden />
				<span className="tabular-nums">
					{online === null
						? tr("dash.live.connecting")
						: tr("dash.live.online", { count: fmt(online), domain: domain ?? "" })}
				</span>
			</p>
			{feed.length === 0 ? (
				<PanelMsg>{tr("dash.live.empty")}</PanelMsg>
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

const ExplorePanel = ({
	siteId,
	dash,
	loading,
	pathFilter,
	onClearPathFilter,
}: DashProps & {
	siteId: string;
	/** Page drill-down from PagesPanel: only journeys touching this path prefix. */
	pathFilter?: string | null;
	onClearPathFilter?: () => void;
}) => {
	const tr = useT();
	const [exploreTab, setExploreTab] = useState<"users" | "journeys">("users");
	const [visitorRowId, setVisitorRowId] = useState<string | null>(null);
	const queryClient = useQueryClient();

	// A page drill-down click always lands on the journeys list.
	useEffect(() => {
		if (pathFilter) setExploreTab("journeys");
	}, [pathFilter]);

	// Slash-safe prefix: "/voltrus-mes" matches "/voltrus-mes" + "/voltrus-mes/…".
	const pathPrefix = pathFilter?.trim().replace(/\/+$/, "") || null;

	const visitorsQ = useQuery({
		enabled: Boolean(siteId),
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
				.filter((v) =>
					pathPrefix
						? v.events.some(
								(e) => e.page === pathPrefix || (e.page?.startsWith(`${pathPrefix}/`) ?? false),
							)
						: true,
				)
				.toSorted((a, b) => (exploreSort === "events" ? b.events.length - a.events.length : 0)),
		[visitorsQ.data, journeys, exploreSort, pathPrefix, dash?.currency],
	);
	const filteredJourneys = useMemo(
		() =>
			pathPrefix
				? journeys.filter((j) =>
						j.steps.some(
							(s) =>
								s.event_type === "pageview" &&
								(s.path === pathPrefix || s.path?.startsWith(`${pathPrefix}/`)),
						),
					)
				: journeys,
		[journeys, pathPrefix],
	);
	const sortedJourneys = useMemo(
		() =>
			exploreSort === "events"
				? filteredJourneys
						.map((j) => ({
							j,
							count: j.steps.filter((s) => s.event_type !== "custom" || s.name !== "heartbeat")
								.length,
						}))
						.toSorted((a, b) => b.count - a.count)
						.map(({ j }) => j)
				: filteredJourneys,
		[filteredJourneys, exploreSort],
	);
	const activeVisitor = visitorRowId ? (visitors.find((v) => v.id === visitorRowId) ?? null) : null;

	return (
		<div className="md:col-span-2 xl:col-span-3">
			<Panel
				tabs={
					<PanelTabs
						value={exploreTab}
						onChange={setExploreTab}
						tabs={[
							{ key: "users", label: "Users" },
							{ key: "journeys", label: "Journeys" },
						]}
					/>
				}
				hint={
					<SortHint
						label={exploreSort === "recent" ? "Recent" : "Events"}
						onToggle={() => setExploreSort(exploreSort === "recent" ? "events" : "recent")}
					/>
				}
			>
				{exploreTab === "users" ? (
					<PanelBody
						loading={visitorsQ.isLoading}
						hasData={visitors.length > 0}
						emptyText={
							pathPrefix ? `No identified visitors touch ${pathPrefix}.` : tr("dash.users.empty")
						}
					>
						<div>
							<div className="text-muted-foreground border-border/60 grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b pb-1.5 text-[11px] sm:grid-cols-[minmax(0,1fr)_130px_64px_170px]">
								<span>Visitor</span>
								<span className="hidden sm:block">Source</span>
								<span className="hidden text-end sm:block">Spent</span>
								<span className="text-end">Last seen</span>
							</div>
							<div className="max-h-[420px] overflow-y-auto">
								{visitors.map((v) => (
									<button
										key={v.id}
										type="button"
										onClick={() => setVisitorRowId(v.id)}
										className="border-border/60 hover:bg-foreground/[0.03] focus-visible:outline-ring -mx-1 grid w-[calc(100%+8px)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-1 py-2 text-left text-[13px] outline-offset-2 last:border-b-0 focus-visible:outline-2 sm:grid-cols-[minmax(0,1fr)_130px_64px_170px]"
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
													<span className="bg-muted text-muted-foreground ml-1.5 rounded px-1 py-0.5 font-mono text-[10px] font-normal">
														{fmt(v.events.length)} events
													</span>
												</span>
												<span className="text-muted-foreground flex items-center gap-1 text-xs">
													<span aria-hidden>{v.flag}</span>
													{v.country ?? "Unknown"} · {v.device ?? "—"} · {v.os ?? "—"} ·{" "}
													{v.browser ?? "—"}
												</span>
											</span>
										</span>
										<span className="text-muted-foreground hidden truncate text-xs sm:block">
											{v.source}
										</span>
										<span className="hidden text-end font-mono text-xs tabular-nums sm:block">
											{v.spent ?? "—"}
										</span>
										<span className="text-end">
											<span className="block text-xs">{v.lastSeen}</span>
											<span className="mt-1 flex justify-end gap-1">
												{v.activity.map((a, i) => (
													<span
														key={i}
														className={`size-1.5 rounded-full ${a ? "bg-(--chart)" : "bg-muted"}`}
													/>
												))}
											</span>
										</span>
									</button>
								))}
							</div>
						</div>
					</PanelBody>
				) : (
					<PanelBody
						loading={loading}
						hasData={filteredJourneys.length > 0}
						emptyText={
							pathPrefix
								? `No journeys touch ${pathPrefix} in the newest ${journeys.length} sessions.`
								: "No journeys in this range."
						}
					>
						{pathPrefix ? (
							<div className="mb-1.5 flex items-center justify-between gap-2">
								<span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]">
									path: {pathPrefix}/*
									{onClearPathFilter ? (
										<button
											type="button"
											onClick={onClearPathFilter}
											aria-label="Clear page filter"
											className="hover:text-foreground focus-visible:outline-ring rounded outline-offset-2 focus-visible:outline-2"
										>
											<X className="size-3" aria-hidden />
										</button>
									) : null}
								</span>
								<span className="text-muted-foreground text-[11px]">
									{filteredJourneys.length} of {journeys.length} sessions
								</span>
							</div>
						) : null}
						<div className="max-h-[420px] overflow-y-auto">
							{sortedJourneys.slice(0, 20).map((j) => {
								const realSteps = j.steps.filter(
									(s) => s.event_type !== "custom" || s.name !== "heartbeat",
								);
								const chips = realSteps.slice(0, 6).map((s) => journeyChip(s, dash?.currency));
								return (
									<div
										key={j.session_id}
										className="border-border/60 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t py-1.5 text-[13px] first:border-t-0"
									>
										<span aria-hidden>{countryFlag(j.country) || "🌐"}</span>
										<span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[10px]">
											{j.utm_source || hostOf(j.referrer) || "direct"}
										</span>
										<span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
											{chips.map((s, i) => (
												<span key={`${s}-${i}`} className="flex items-center gap-1">
													{i > 0 ? (
														<ArrowRight className="text-muted-foreground/60 size-3" aria-hidden />
													) : null}
													<span className="bg-muted/70 rounded-full px-2 py-0.5 font-mono text-[11px]">
														{s}
													</span>
												</span>
											))}
										</span>
										<span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[10px]">
											{fmt(realSteps.length)} events
										</span>
										{j.visitor_name ? (
											<span className="rounded-full bg-(--chart)/10 px-2 py-0.5 text-[11px] text-(--chart)">
												{j.visitor_name}
											</span>
										) : null}
										<span className="text-muted-foreground font-mono text-xs tabular-nums">
											{agoLabel(j.started_at)}
										</span>
										{j.total_revenue > 0 ? (
											<span className="inline-flex items-center gap-1 rounded-full bg-(--chart)/10 px-2 py-0.5 font-mono text-[11px] text-(--chart)">
												<Check className="size-3" aria-hidden />
												{money(j.total_revenue, dash?.currency)}
											</span>
										) : (
											<span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]">
												Exited
											</span>
										)}
									</div>
								);
							})}
						</div>
					</PanelBody>
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

const FunnelSection = ({
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

	return (
		<section className="bg-card ring-foreground/10 rounded-2xl p-3 ring-1">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				{funnel?.pages.length ? (
					<div className="min-w-0 flex-1 overflow-x-auto [&_[role=tablist]]:w-max">
						<PanelTabs
							value={activePath}
							onChange={setFunnelPath}
							tabs={funnel.pages.map((p) => ({ key: p.path, label: p.path }))}
						/>
					</div>
				) : (
					<h2 className="text-sm font-semibold">Scroll funnel</h2>
				)}
				<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
					{/* Phones: the chart overlay would sit on the bands, so the rate moves here. */}
					{funnelSteps.length > 0 && !funnelQ.error ? (
						<span className="text-foreground font-semibold sm:hidden">
							{tr("dash.funnel.rate", { rate: funnelRate })} ·{" "}
						</span>
					) : null}
					data-section scroll funnel
				</span>
			</div>
			<PanelBody
				loading={funnelQ.isLoading}
				hasData={funnelSteps.length > 0 || Boolean(funnelQ.error)}
				emptyText="No funnel data — needs pageview + scroll_section events."
			>
				{lockedPlan ? (
					<GrowthLocked
						feature="Funnels"
						plan={planLabel(lockedPlan)}
						onUpgrade={() => onUpgrade(lockedPlan)}
					/>
				) : funnelQ.error ? (
					<PanelMsg>
						{isSubscriptionInactive(funnelQ.error)
							? "Pick a plan to see funnels."
							: "Couldn't load the funnel."}
					</PanelMsg>
				) : (
					<FunnelChart rate={funnelRate} steps={funnelSteps} />
				)}
			</PanelBody>
		</section>
	);
};

/**
 * Live visitor count. The dot marks a real live state, so it stays, but
 * static: the theme's MOTION 1 dial allows no endless pulse.
 */
const OnlinePill = ({ online, className }: { online: number | null; className: string }) => (
	<span
		className={`bg-card ring-foreground/10 items-center gap-2 rounded-full px-2.5 py-1 text-[13px] whitespace-nowrap tabular-nums ring-1 ${className}`}
	>
		<span className="size-2 rounded-full bg-(--up)" aria-hidden />
		{online === null ? "…" : fmt(online)} online
	</span>
);

const TopBar = ({
	view,
	onView,
	sites,
	siteId,
	onPickSite,
	sitesLoading,
	rangeKey,
	onRange,
	online,
	onManageSites,
	onExport,
	exporting,
}: {
	view: ViewKey;
	onView: (v: ViewKey) => void;
	sites: { id: string; domain: string }[];
	siteId: string;
	onPickSite: (id: string) => void;
	sitesLoading: boolean;
	rangeKey: RangeKey;
	onRange: (r: RangeKey) => void;
	online: number | null;
	onManageSites: () => void;
	onExport: () => void;
	exporting: boolean;
}) => (
	// Sticky from sm only: on phones the three header rows would hold ~150px
	// of an 844px screen for the whole scroll.
	<header className="border-border/60 bg-background/85 z-20 border-b backdrop-blur sm:sticky sm:top-0">
		<div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-2 md:px-4">
			<Link
				to="/analytics"
				aria-label="RevKlik: all sites"
				title="All sites"
				className="hover:bg-accent focus-visible:outline-ring -m-1 flex items-center gap-2.5 rounded-lg p-1 outline-offset-2 transition-colors"
			>
				<BrandMark className="h-5 w-auto" />
				{/* Phones keep the mark only: the site picker needs the width. */}
				<span className="hidden text-[15px] font-semibold tracking-tight sm:inline">RevKlik</span>
			</Link>

			<Select
				value={siteId}
				onValueChange={(v) => {
					if (v === "__manage") {
						onManageSites();
						return;
					}
					onPickSite(String(v));
				}}
			>
				<SelectTrigger
					aria-label="Website"
					className="bg-card ring-foreground/10 focus-visible:outline-ring data-[placeholder]:text-foreground hover:bg-accent dark:bg-card dark:hover:bg-accent h-auto w-auto gap-2 rounded-full px-2.5 py-1 text-[13px] font-medium ring-1"
				>
					<span className="size-2 rounded-full bg-(--chart)" aria-hidden />
					<SelectValue placeholder={sitesLoading ? "Loading…" : "Site"}>
						{sites.find((s) => s.id === siteId)?.domain ?? (sitesLoading ? "Loading…" : "Site")}
					</SelectValue>
				</SelectTrigger>
				<SelectContent align="start" className="min-w-44">
					{sites.map((s) => (
						<SelectItem key={s.id} value={s.id}>
							{s.domain}
						</SelectItem>
					))}
					<SelectSeparator />
					<SelectItem value="__manage">
						<span className="flex items-center gap-1.5">
							<Plus className="size-3.5" aria-hidden />
							Manage sites
						</span>
					</SelectItem>
				</SelectContent>
			</Select>

			{view === "home" ? (
				// Phones: the online count stays on the brand row and the ranges
				// get a full-width row; from sm everything shares one row.
				<OnlinePill online={online} className="ms-auto flex sm:hidden" />
			) : null}

			{view === "home" ? (
				<div className="flex w-full items-center gap-2 sm:ms-auto sm:w-auto">
					<div className="bg-muted/70 flex flex-1 rounded-full p-1 sm:flex-none">
						{RANGES.map((r) => (
							<button
								key={r.key}
								type="button"
								aria-pressed={rangeKey === r.key}
								onClick={() => onRange(r.key)}
								className={`focus-visible:outline-ring flex-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium tabular-nums outline-offset-2 focus-visible:outline-2 sm:flex-none sm:py-1 ${
									rangeKey === r.key
										? "bg-card text-foreground ring-foreground/10 ring-1"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{r.label}
							</button>
						))}
					</div>
					<Button
						size="icon"
						variant="ghost"
						aria-label="Export CSV"
						title="Export CSV (events)"
						disabled={exporting || !siteId}
						onClick={onExport}
						className="ring-foreground/10 bg-card hover:bg-accent size-9 shrink-0 rounded-full ring-1 sm:size-7"
					>
						<Download className={`size-3.5 ${exporting ? "animate-pulse" : ""}`} aria-hidden />
					</Button>
					<OnlinePill online={online} className="hidden sm:flex" />
				</div>
			) : null}

			<NavTabs
				view={view}
				onView={onView}
				// Absolute centring only from lg: between 768 and 1024px the
				// tabs would overlap the site picker and the range pills.
				className="order-last w-full min-w-0 justify-start max-sm:pe-8 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:justify-center lg:absolute lg:top-1/2 lg:left-1/2 lg:order-none lg:w-auto lg:min-w-fit lg:-translate-x-1/2 lg:-translate-y-1/2"
			/>
		</div>
	</header>
);

const FiltersBar = ({
	siteId,
	filters,
	setFilters,
	draftDim,
	setDraftDim,
	draftOp,
	setDraftOp,
	draftValue,
	setDraftValue,
	addFilter,
}: {
	filters: LegacyFilter[];
	setFilters: (updater: (prev: LegacyFilter[]) => LegacyFilter[]) => void;
	draftDim: string;
	setDraftDim: (d: string) => void;
	draftOp: FilterOperator;
	setDraftOp: (o: FilterOperator) => void;
	draftValue: string;
	setDraftValue: (v: string) => void;
	addFilter: () => void;
	siteId: string;
}) => {
	const voidOp = draftOp === "exists" || draftOp === "not_exists";
	return (
		<div className="mb-2.5 flex flex-wrap items-center gap-2">
			<span className="text-muted-foreground text-xs font-medium">Filters</span>
			<Select
				value={draftDim}
				onValueChange={(v) => {
					setDraftDim(String(v));
					setDraftValue("");
				}}
			>
				<SelectTrigger aria-label="Filter dimension" className="h-8 w-36 text-xs">
					<SelectValue placeholder="Dimension" />
				</SelectTrigger>
				<SelectContent>
					{FILTER_DIMS.map((d) => (
						<SelectItem key={d.value} value={d.value}>
							{d.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{draftDim ? (
				<>
					<Select value={draftOp} onValueChange={(v) => setDraftOp(String(v) as FilterOperator)}>
						<SelectTrigger aria-label="Filter operator" className="h-8 w-28 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FILTER_OPS.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{voidOp ? null : (
						<Input
							aria-label="Filter value"
							value={draftValue}
							placeholder="Value…"
							onChange={(e) => setDraftValue(e.target.value)}
							className="h-8 w-44 text-xs"
						/>
					)}
				</>
			) : null}
			<button
				type="button"
				onClick={addFilter}
				disabled={!draftDim}
				className="bg-muted/70 hover:bg-muted focus-visible:outline-ring flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium outline-offset-2 focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-40"
			>
				<Plus className="size-3" aria-hidden />
				Add
			</button>
			{filters.map((flt) => (
				<span
					key={`${flt.dimension}-${flt.operator}-${flt.value}`}
					className="inline-flex items-center gap-1 rounded-full bg-(--chart)/10 px-2 py-0.5 text-xs font-medium text-(--chart)"
				>
					{flt.dimension} {flt.operator.replaceAll("_", " ")} {flt.value}
					<button
						type="button"
						aria-label={`Remove filter ${flt.dimension} ${flt.value}`}
						onClick={() =>
							setFilters((prev) =>
								prev.filter(
									(x) =>
										!(
											x.dimension === flt.dimension &&
											x.operator === flt.operator &&
											x.value === flt.value
										),
								),
							)
						}
						className="hover:text-foreground focus-visible:outline-ring outline-offset-2 focus-visible:outline-2"
					>
						<X className="size-3" aria-hidden />
					</button>
				</span>
			))}
			{filters.length ? (
				<button
					type="button"
					onClick={() => setFilters(() => [])}
					className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
				>
					Clear all
				</button>
			) : null}
			<SegmentControls
				siteId={siteId}
				filters={filters}
				onApply={(next) => setFilters(() => next)}
			/>
		</div>
	);
};

const StatTiles = ({
	stats,
	compare,
	currency,
}: {
	stats: SiteDashboard["stats"] | undefined;
	compare: SiteDashboard["compare"];
	currency?: string;
}) => {
	const tr = useT();
	const badge = (k: CompareKey, lowerIsBetter = false) => {
		const d = deltaBadge(compare?.[k], lowerIsBetter);
		return d ? { delta: d.label, tone: d.tone } : {};
	};
	// Bounce and duration are session aggregates: with no sessions in range
	// they would read as a real "0.0%" / "0m 00s", so say there is no data.
	const noSessions = stats !== undefined && stats.sessions === 0;
	return (
		// Five tiles: Revenue spans the row on phones (2 cols) and two columns at
		// sm (3 cols), so no row ends with a lone half-width tile.
		<div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			<StatTile
				label="Visitors"
				value={stats ? fmt(stats.visitors) : undefined}
				{...badge("visitors")}
			/>
			<StatTile
				label="Pageviews"
				value={stats ? fmt(stats.pageviews) : undefined}
				{...badge("pageviews")}
			/>
			<StatTile
				label="Bounce rate"
				value={stats ? `${stats.bounceRate.toFixed(1)}%` : undefined}
				note={noSessions ? tr("dash.noSessions") : undefined}
				{...(noSessions ? {} : badge("bounceRate", true))}
			/>
			<StatTile
				label="Visit duration"
				value={stats ? duration(stats.avgDuration) : undefined}
				note={noSessions ? tr("dash.noSessions") : undefined}
				{...(noSessions ? {} : badge("avgDuration"))}
			/>
			<StatTile
				label="Revenue"
				value={stats ? money(stats.revenue, currency) : undefined}
				className="col-span-2 lg:col-span-1"
				{...badge("revenue")}
			/>
		</div>
	);
};

/** Replaces the empty traffic chart until the site's first event arrives. */
const InstallPrompt = ({ domain, onInstall }: { domain: string; onInstall: () => void }) => {
	const t = useT();
	return (
		<div className="flex min-h-52 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
			<p className="text-sm font-semibold">{t("install.emptyTitle")}</p>
			<p className="text-muted-foreground max-w-sm text-xs">{t("install.emptyDesc", { domain })}</p>
			<Button className="mt-2 h-9" onClick={onInstall}>
				<Code2 className="size-3.5" aria-hidden />
				{t("install.cta")}
			</Button>
		</div>
	);
};

/* --------------------------------- page ------------------------------------ */

const AnalyticsPage = ({
	siteId: siteIdParam,
	view,
	onView,
	highlightPlan,
}: {
	siteId: string;
	/** Active section, owned by the route's ?view= search param. */
	view: ViewKey;
	onView: (view: ViewKey) => void;
	highlightPlan?: PlanTier;
}) => {
	const tr = useT();
	const navigate = useNavigate();
	const setView = onView;
	const [snippetOpen, setSnippetOpen] = useState(false);
	const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
	const [filters, setFilters] = useState<LegacyFilter[]>([]);
	const [draftDim, setDraftDim] = useState("");
	const [draftOp, setDraftOp] = useState<FilterOperator>("is");
	const [draftValue, setDraftValue] = useState("");
	const [live, setLive] = useState<{
		online: number | null;
		feed: LiveFeedItem[];
	}>({ feed: [], online: null });
	const [sitesOpen, setSitesOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [annotations, setAnnotations] = useState<LegacyAnnotation[]>([]);

	const sitesQ = useQuery({
		queryFn: () => fetchSites(rangeKey),
		queryKey: ["legacy", "sites", rangeKey],
		// Keep the previous list visible while a new range loads: a blank list
		// makes siteId fall back to "" and the picker appear to reset.
		placeholderData: (prev) => prev,
		retry: false,
		staleTime: 60_000,
	});

	const sites = sitesQ.data ?? [];
	const siteId = sites.some((s) => s.id === siteIdParam) ? siteIdParam : "";

	// Stale URL param (site deleted elsewhere): fall back to the overview.
	const siteMissing =
		sitesQ.isSuccess && sites.length > 0 && !sites.some((s) => s.id === siteIdParam);
	useEffect(() => {
		if (siteMissing) {
			void navigate({ to: "/analytics" });
		}
	}, [siteMissing, navigate]);
	const site = sites.find((s) => s.id === siteId);
	const filterStr = encodeFilterString(filters);

	const dashQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchDashboard(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "dash", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const dash = dashQ.data;
	const loadingDash = dashQ.isLoading;

	const queryClient = useQueryClient();
	const [visitorSheetId, setVisitorSheetId] = useState<string | null>(null);
	// Page drill-down: set by clicking a row in PagesPanel, consumed by
	// ExplorePanel's journey/user lists.
	const [journeyPath, setJourneyPath] = useState<string | null>(null);
	const sheetProfilesQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchVisitors(siteId),
		queryKey: ["legacy", "visitors", siteId],
		retry: false,
		staleTime: 30_000,
	});
	const saveSheetVisitor = useMutation({
		mutationFn: ({ id, patch }: { id: string; patch: { tags: string[]; note: string } }) =>
			updateVisitor(id, {
				notes: patch.note,
				tags: JSON.stringify(patch.tags),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["legacy", "visitors"] });
		},
	});
	const [sheetFetched, setSheetFetched] = useState<VisitorProfileResult | null>(null);
	const sheetVisitor = useMemo(() => {
		if (!visitorSheetId) {
			return null;
		}
		const local = (sheetProfilesQ.data ?? []).find((x) => x.visitor_id === visitorSheetId);
		if (local) {
			return profileToVisitor(local, dash?.journeys ?? NO_JOURNEYS, dash?.currency);
		}
		return sheetFetched?.profile.visitor_id === visitorSheetId
			? profileToVisitor(sheetFetched.profile, sheetFetched.journeys, dash?.currency)
			: null;
	}, [visitorSheetId, sheetProfilesQ.data, sheetFetched, dash]);

	const openVisitorSheet = (id: string) => {
		const known = (sheetProfilesQ.data ?? []).some((x) => x.visitor_id === id);
		if (known) {
			setVisitorSheetId(id);
			return;
		}
		fetchVisitorProfile(id, siteId, rangeKey)
			.then((res) => {
				setSheetFetched(res);
				setVisitorSheetId(id);
			})
			.catch(() => {
				toast.error("Couldn't load that visitor's profile.");
			});
	};

	useEffect(() => {
		if (!siteId) {
			return;
		}
		let liveSeq = 0;
		return connectSSE(siteId, ({ type, data }) => {
			if (type === "stats") {
				const d = data as { live_visitors?: number };
				setLive((s) => ({ ...s, online: d.live_visitors ?? s.online }));
			} else if (type === "visitor") {
				const d = data as {
					id?: string;
					visitor_id?: string;
					event_type?: string;
					path?: string;
					country?: string | null;
					city?: string | null;
					timestamp?: string;
				};
				// The stream carries every event type; heartbeats and scrolls
				// would flood a feed that is meant to show visits.
				if (d.event_type && d.event_type !== "pageview" && d.event_type !== "conversion") {
					return;
				}
				const at = d.timestamp ?? new Date().toISOString();
				liveSeq += 1;
				// Event ids are unique; the fallback adds a per-tab sequence because
				// one poll can deliver several events with the same timestamp.
				const key = d.id ?? `${d.visitor_id ?? "anon"}-${at}-${liveSeq}`;
				setLive((s) =>
					s.feed.some((f) => f.key === key)
						? s
						: {
								...s,
								feed: [
									{
										at,
										flag: countryFlag(d.country),
										key,
										path: d.path ?? "/",
										place: d.city ?? null,
									},
									...s.feed,
								].slice(0, LIVE_FEED_MAX),
							},
				);
			}
		});
	}, [siteId]);

	const hourly = rangeKey === "24h";
	const points: Point[] = useMemo(
		() =>
			(dash?.timeseries ?? []).map((t) => ({
				...pointLabel(t.date, hourly),
				date: t.date,
				current: t.visitors,
			})),
		[dash, hourly],
	);

	// Revenue bars aligned to the visitor buckets by date (24h = hourly buckets).
	const revenueSeries: number[] | undefined = useMemo(() => {
		if (!dash || (dash.revenueTimeseries ?? []).length === 0) {
			return undefined;
		}
		const byDate = new Map(dash.revenueTimeseries.map((r) => [r.date.slice(0, 10), r.revenue]));
		const aligned = points.map((p) => byDate.get(p.date?.slice(0, 10) ?? "") ?? 0);
		return aligned.some((v) => v > 0) ? aligned : undefined;
	}, [dash, points]);

	const pickSite = (id: string) => {
		setLive({ feed: [], online: null });
		// Keep the open section (?view=) when switching sites.
		void navigate({
			params: { siteId: id },
			search: (prev) => ({ view: prev.view }),
			to: "/analytics/$siteId",
		});
	};

	const addFilter = () => {
		const needsValue = draftOp !== "exists" && draftOp !== "not_exists";
		if (!draftDim || (needsValue && !draftValue)) {
			return;
		}
		setFilters((prev) =>
			prev.some((x) => x.dimension === draftDim && x.operator === draftOp && x.value === draftValue)
				? prev
				: [...prev, { dimension: draftDim, operator: draftOp, value: draftValue }],
		);
	};

	const exportSiteCsv = () => {
		if (!siteId || exporting) {
			return;
		}
		setExporting(true);
		exportLegacyFile({
			siteId,
			range: rangeKey,
			type: "events",
			format: "csv",
			filters: filterStr,
		})
			.then((name) => toast.success(`Exported ${name}`))
			.catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Export failed"))
			.finally(() => setExporting(false));
	};

	const stats = dash?.stats;
	const cmp = dash?.compare;

	const firstError = [sitesQ.error, dashQ.error].find(Boolean);
	// Lapsed trial/subscription: the home view becomes an upgrade lock;
	// billing and settings stay reachable through the tabs.
	const inactiveError = isSubscriptionInactive(firstError) ? firstError : null;
	const errorMsg = firstError instanceof Error && !inactiveError ? firstError.message : "";
	const noTrafficYet = Boolean(site && !siteHasEvents(site) && dash && dash.stats.pageviews === 0);

	return (
		<div className="bg-background text-foreground min-h-svh">
			<TopBar
				view={view}
				onView={setView}
				sites={sites}
				siteId={siteId}
				onPickSite={pickSite}
				sitesLoading={sitesQ.isLoading}
				rangeKey={rangeKey}
				onRange={setRangeKey}
				online={live.online}
				onManageSites={() => setSitesOpen(true)}
				onExport={exportSiteCsv}
				exporting={exporting}
			/>

			{view === "home" && inactiveError ? (
				<UpgradeLock error={inactiveError} onUpgrade={() => setView("billing")} />
			) : view === "home" ? (
				<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
					<AccountNotices onUpgrade={() => setView("billing")} />
					{errorMsg ? (
						<p
							className="mb-2.5 rounded-xl bg-(--down)/10 px-3 py-2 text-xs text-(--down)"
							role="alert"
						>
							{errorMsg}
						</p>
					) : null}

					<FiltersBar
						siteId={siteId}
						filters={filters}
						setFilters={setFilters}
						draftDim={draftDim}
						setDraftDim={setDraftDim}
						draftOp={draftOp}
						setDraftOp={setDraftOp}
						draftValue={draftValue}
						setDraftValue={setDraftValue}
						addFilter={addFilter}
					/>

					<StatTiles stats={stats} compare={cmp} currency={dash?.currency} />
					<section className="bg-card ring-foreground/10 mb-2.5 rounded-2xl p-3 ring-1">
						<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
							<div className="text-muted-foreground flex items-center gap-4 text-xs">
								<span className="flex items-center gap-1.5">
									<span className="h-0.5 w-4 rounded-full bg-(--chart)" aria-hidden />
									Visitors
								</span>
								{revenueSeries ? (
									<span className="flex items-center gap-1.5">
										<span className="bg-(--money) h-2.5 w-2.5 rounded-[3px]" aria-hidden />
										Revenue
									</span>
								) : null}
							</div>
							<span className="flex flex-wrap items-center gap-2">
								<AnnotationsControl siteId={siteId} onAnnotations={setAnnotations} />
								<span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
									{points[0]?.full}
									{points.length > 1 ? ` – ${points.at(-1)?.full}` : ""}
								</span>
							</span>
						</div>
						{noTrafficYet && site ? (
							<InstallPrompt domain={site.domain} onInstall={() => setSnippetOpen(true)} />
						) : (
							<PanelBody
								loading={loadingDash}
								hasData={points.length > 0}
								emptyText="No traffic in this range."
								skeleton={
									// Same box as the chart (h-52/h-60 + tick row) so nothing jumps.
									<div className="mb-5 h-52 md:h-60" role="status">
										<span className="sr-only">{tr("dash.loadingChart")}</span>
										<div className="bg-muted/40 h-full animate-pulse rounded-lg" aria-hidden />
									</div>
								}
							>
								<TrafficChart
									points={points}
									annotations={annotations}
									revenue={revenueSeries}
									currency={dash?.currency}
								/>
							</PanelBody>
						)}
					</section>
					<div className="mb-2.5">
						<AiInsightsPanel
							onUpgrade={() => setView("billing")}
							siteId={siteId}
							rangeKey={rangeKey}
						/>
					</div>

					<div className="mb-2.5 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
						<PagesPanel dash={dash} loading={loadingDash} onSelectPath={setJourneyPath} />
						<SourcesPanel dash={dash} loading={loadingDash} />
						<LocationPanel siteId={siteId} rangeKey={rangeKey} filterStr={filterStr} />
						<PlatformPanel dash={dash} loading={loadingDash} />
						<RevenuePanel
							dash={dash}
							loading={loadingDash}
							siteId={siteId}
							rangeKey={rangeKey}
							filterStr={filterStr}
						/>
						<LivePanel domain={site?.domain} online={live.online} feed={live.feed} />
						<ExplorePanel
							onClearPathFilter={() => setJourneyPath(null)}
							dash={dash}
							loading={loadingDash}
							pathFilter={journeyPath}
							siteId={siteId}
						/>
						<HeatmapPanel
							onUpgrade={() => setView("billing")}
							filterStr={filterStr}
							rangeKey={rangeKey}
							siteId={siteId}
							topPages={dash?.topPages ?? []}
						/>
						<RecordingsPanel
							onUpgrade={() => setView("billing")}
							filterStr={filterStr}
							rangeKey={rangeKey}
							siteId={siteId}
						/>
						{/* Fifth cell of the 2-col grid: span the row instead of leaving a gap. */}
						<div className="grid md:col-span-2 xl:col-span-1">
							<PredictionsPanel
								onOpenVisitor={openVisitorSheet}
								onUpgrade={() => setView("billing")}
								siteId={siteId}
							/>
						</div>
					</div>
					<div className="mb-2.5">
						<CrawlersPanel siteId={siteId} rangeKey={rangeKey} />
					</div>
					<FunnelSection
						siteId={siteId}
						rangeKey={rangeKey}
						filterStr={filterStr}
						onUpgrade={openBilling}
					/>
				</main>
			) : view === "share" ? (
				<ShareWidgetTokensView />
			) : view === "billing" ? (
				<BillingView highlightPlan={highlightPlan} />
			) : view === "admin" ? (
				<AdminView />
			) : view === "integrations" ? (
				<IntegrationsView siteId={siteId} />
			) : (
				<SettingsView
					site={site?.domain}
					siteId={siteId}
					onSignOut={() => navigate({ to: "/login" })}
				/>
			)}
			<SitesView open={sitesOpen} onClose={() => setSitesOpen(false)} />
			{snippetOpen && site ? (
				<SnippetModal
					site={{ domain: site.domain, hasEvents: false, id: site.id }}
					onClose={() => setSnippetOpen(false)}
				/>
			) : null}
			{sheetVisitor ? (
				<VisitorSheet
					key={sheetVisitor.id}
					visitor={sheetVisitor}
					onClose={() => setVisitorSheetId(null)}
					onSave={async (patch) => {
						await saveSheetVisitor.mutateAsync({ id: sheetVisitor.id, patch });
					}}
				/>
			) : null}
		</div>
	);
};

export default AnalyticsPage;

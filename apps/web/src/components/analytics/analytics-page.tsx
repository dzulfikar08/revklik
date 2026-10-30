import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { openBilling } from "@/lib/billing-nav";
import { rememberActiveSite } from "@/lib/active-site";
import { useLocale, useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import {
	connectSSE,
	countryFlag,
	encodeFilterString,
	fetchDashboard,
	fetchSites,
	isSubscriptionInactive,
} from "@/lib/legacy/api";
import type { LegacyFilter } from "@/lib/legacy/api";
import type { LegacyAnnotation } from "@/lib/legacy/analytics-settings";
import type { PlanTier } from "@/lib/legacy/billing";
import { exportLegacyFile } from "@/lib/legacy/sites";

import { AdminView } from "./admin-view";
import { AccountNotices } from "./account-notices";
import { AiInsightsPanel } from "./ai-insights";
import { AppShell } from "./app-shell";
import type { NavKey } from "./app-shell";
import { BillingView } from "./billing-view";
import {
	BuyersPanel,
	LocationPanel,
	PagesPanel,
	PlatformPanel,
	SellsPanel,
	SourcesPanel,
} from "./breakdown-panels";
import type { DashState, FilterHandle, WidenAction } from "./breakdown-panels";
import {
	CrawlersPanel,
	ExplorePanel,
	FunnelSection,
	LIVE_FEED_MAX,
	LivePanel,
} from "./behavior-panels";
import type { LiveFeedItem } from "./behavior-panels";
import { pointLabel } from "./data";
import type { Point, RangeKey } from "./data";
import { FiltersBar } from "./filters-bar";
import { toggleFilter } from "./filter-model";
import { RunRateForecastPanel } from "./forecast-panel";
import { HeatmapPanel } from "./heatmap";
import {
	ChartCard,
	Hero,
	HomeToolbar,
	NextStepsCard,
	SecondaryStats,
	SectionSwitch,
} from "./home-view";
import type { HomeSection, NextAction } from "./home-view";
import { IntegrationsView } from "./integrations-view";
import { deriveNextSteps } from "./next-steps";
import { RecordingsPanel } from "./recordings";
import { SettingsView } from "./settings";
import { ShareWidgetTokensView } from "./share-widget-tokens";
import { SitesView } from "./sites-view";
import { siteHasEvents, SnippetModal } from "./snippet-modal";
import { UpgradeLock } from "./upgrade-lock";
import type { ViewKey } from "./views";

const NEXT_RANGE: Partial<Record<RangeKey, RangeKey>> = { "24h": "7d", "30d": "90d", "7d": "30d" };

const ACTIVE_NAV: Record<ViewKey, NavKey | null> = {
	admin: null,
	billing: null,
	home: "overview",
	integrations: "connect",
	settings: "settings",
	share: "share",
};

const VIEW_TITLE: Record<ViewKey, MessageKey> = {
	admin: "menu.admin",
	billing: "menu.billing",
	home: "nav.overview",
	integrations: "nav.connect",
	settings: "nav.settings",
	share: "nav.share",
};

const NO_FILTERS: LegacyFilter[] = [];

const AnalyticsPage = ({
	siteId,
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
	const t = useT();
	const locale = useLocale();
	const navigate = useNavigate();
	const [snippetOpen, setSnippetOpen] = useState(false);
	const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
	const [filters, setFilters] = useState<LegacyFilter[]>(NO_FILTERS);
	const [section, setSection] = useState<HomeSection>("traffic");
	const [live, setLive] = useState<{ online: number | null; feed: LiveFeedItem[] }>({
		feed: [],
		online: null,
	});
	const [sitesOpen, setSitesOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [annotations, setAnnotations] = useState<LegacyAnnotation[]>([]);

	const sitesQ = useQuery({
		// Failures render inline with a Retry button, not as a toast.
		meta: { silent: true },
		queryFn: () => fetchSites(rangeKey),
		queryKey: ["legacy", "sites", rangeKey],
		// Keep the previous list visible while a new range loads so the picker does not reset.
		placeholderData: (prev) => prev,
		retry: false,
		staleTime: 60_000,
	});
	const sites = sitesQ.data ?? [];
	const site = sites.find((s) => s.id === siteId);

	// Stale URL param (site deleted elsewhere): fall back to the overview.
	const siteMissing = sitesQ.isSuccess && sites.length > 0 && !site;
	useEffect(() => {
		if (siteMissing) {
			void navigate({ to: "/analytics" });
		} else if (site) {
			rememberActiveSite(site.id);
		}
	}, [siteMissing, site, navigate]);

	const filterStr = encodeFilterString(filters);

	// The URL names the site, so the dashboard loads in parallel with the site list.
	const dashQ = useQuery({
		enabled: Boolean(siteId),
		meta: { silent: true },
		queryFn: () => fetchDashboard(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "dash", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const dash = dashQ.data;

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
			(dash?.timeseries ?? []).map((p) => ({
				...pointLabel(p.date, hourly),
				current: p.visitors,
				date: p.date,
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

	const firstPoint = points[0];
	const lastPoint = points.at(-1);
	let period: string | undefined;
	if (firstPoint && lastPoint) {
		period = hourly
			? `${firstPoint.full} – ${lastPoint.full}`
			: `${firstPoint.label} – ${lastPoint.label}`;
	}

	const pickSite = (id: string) => {
		setLive({ feed: [], online: null });
		setFilters(NO_FILTERS);
		// Keep the open section (?view=) when switching sites.
		void navigate({
			params: { siteId: id },
			search: (prev) => ({ view: prev.view }),
			to: "/analytics/$siteId",
		});
	};

	const exportSiteCsv = () => {
		if (!siteId || exporting) {
			return;
		}
		setExporting(true);
		exportLegacyFile({
			filters: filterStr,
			format: "csv",
			range: rangeKey,
			siteId,
			type: "events",
		})
			.then((name) => toast.success(t("home.exported", { name })))
			.catch((e: unknown) =>
				toast.error(e instanceof Error && e.message ? e.message : t("home.exportFailed")),
			)
			.finally(() => setExporting(false));
	};

	const firstError = sitesQ.error ?? dashQ.error;
	// Lapsed trial/subscription: the home view becomes an upgrade lock;
	// billing and settings stay reachable through the nav.
	const inactiveError = isSubscriptionInactive(firstError) ? firstError : null;
	const dashError = isSubscriptionInactive(dashQ.error) ? null : (dashQ.error ?? sitesQ.error);
	const dashState: DashState = {
		dash,
		error: dashError,
		loading: dashQ.isPending && !dashQ.error && !sitesQ.error,
		onRetry: () => {
			void dashQ.refetch();
			if (sitesQ.error) {
				void sitesQ.refetch();
			}
		},
		retrying: dashQ.isFetching || sitesQ.isFetching,
	};
	const noTrafficYet = Boolean(site && !siteHasEvents(site) && dash && dash.stats.pageviews === 0);

	const handle: FilterHandle = {
		filters,
		onToggle: (dimension, value) => setFilters((prev) => toggleFilter(prev, dimension, value)),
	};
	const nextRange = NEXT_RANGE[rangeKey];
	const widen: WidenAction | undefined = nextRange
		? { label: t("empty.widen", { range: nextRange }), onClick: () => setRangeKey(nextRange) }
		: undefined;

	const runNextAction = (action: NextAction) => {
		if (action.kind === "install") {
			setSnippetOpen(true);
		} else if (action.kind === "connect") {
			onView("integrations");
		} else {
			setFilters((prev) =>
				prev.some((f) => f.dimension === action.dimension && f.value === action.value)
					? prev
					: toggleFilter(prev, action.dimension, action.value),
			);
		}
	};

	useEffect(() => {
		document.title = `${site?.domain ?? "RevKlik"} · ${t(VIEW_TITLE[view])} · RevKlik`;
	}, [site?.domain, view, t]);

	const renderHome = () => (
		<main className="mx-auto max-w-7xl px-3 pt-4 pb-8 md:px-4">
			<AccountNotices onUpgrade={() => openBilling()} />
			<HomeToolbar
				domain={site?.domain}
				period={period}
				rangeKey={rangeKey}
				onRange={setRangeKey}
				onExport={exportSiteCsv}
				exporting={exporting}
			/>
			<FiltersBar siteId={siteId} filters={filters} onChange={setFilters} />
			<Hero dash={dash} loading={dashState.loading} />
			<SecondaryStats stats={dash?.stats} compare={dash?.compare} loading={dashState.loading} />
			<ChartCard
				siteId={siteId}
				points={points}
				revenue={revenueSeries}
				currency={dash?.currency}
				annotations={annotations}
				onAnnotations={setAnnotations}
				loading={dashState.loading}
				error={dashState.error}
				onRetry={dashState.onRetry}
				retrying={dashState.retrying}
				noTrafficYet={noTrafficYet}
				domain={site?.domain}
				onInstall={() => setSnippetOpen(true)}
				widen={widen}
			/>
			<div className="mb-3 grid gap-3 lg:grid-cols-2">
				<BuyersPanel
					state={dashState}
					handle={handle}
					siteId={siteId}
					rangeKey={rangeKey}
					filterStr={filterStr}
					widen={widen}
				/>
				<SellsPanel state={dashState} handle={handle} widen={widen} />
			</div>
			<NextStepsCard
				steps={deriveNextSteps(dash, Boolean(site && siteHasEvents(site)))}
				onAction={runNextAction}
			/>
			<div className="mb-3 grid gap-3 lg:grid-cols-2">
				<AiInsightsPanel onUpgrade={() => openBilling()} siteId={siteId} rangeKey={rangeKey} />
				<RunRateForecastPanel siteId={siteId} currency={dash?.currency} />
			</div>
			<SectionSwitch value={section} onChange={setSection} />
			{section === "traffic" ? (
				<div className="grid gap-3 md:grid-cols-2">
					<SourcesPanel state={dashState} handle={handle} widen={widen} />
					<PagesPanel state={dashState} handle={handle} widen={widen} />
					<LocationPanel
						siteId={siteId}
						rangeKey={rangeKey}
						filterStr={filterStr}
						handle={handle}
						widen={widen}
					/>
					<PlatformPanel state={dashState} handle={handle} widen={widen} />
				</div>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					<LivePanel domain={site?.domain} online={live.online} feed={live.feed} />
					<HeatmapPanel
						onUpgrade={() => openBilling()}
						filterStr={filterStr}
						rangeKey={rangeKey}
						siteId={siteId}
						topPages={dash?.topPages ?? []}
					/>
					<ExplorePanel
						siteId={siteId}
						dash={dash}
						loading={dashState.loading}
						error={dashState.error}
						onRetry={dashState.onRetry}
					/>
					<RecordingsPanel
						onUpgrade={() => openBilling()}
						filterStr={filterStr}
						rangeKey={rangeKey}
						siteId={siteId}
					/>
					<div className="md:col-span-2">
						<FunnelSection
							siteId={siteId}
							rangeKey={rangeKey}
							filterStr={filterStr}
							onUpgrade={openBilling}
						/>
					</div>
					<div className="md:col-span-2">
						<CrawlersPanel siteId={siteId} rangeKey={rangeKey} />
					</div>
				</div>
			)}
		</main>
	);

	const renderView = () => {
		switch (view) {
			case "home":
				return inactiveError ? (
					<UpgradeLock error={inactiveError} onUpgrade={() => openBilling()} />
				) : (
					renderHome()
				);
			case "share":
				return <ShareWidgetTokensView siteId={siteId} />;
			case "billing":
				return <BillingView highlightPlan={highlightPlan} />;
			case "admin":
				return <AdminView />;
			case "integrations":
				return <IntegrationsView siteId={siteId} />;
			default:
				return (
					<SettingsView
						site={site?.domain}
						siteId={siteId}
						onSignOut={() => navigate({ to: "/login" })}
					/>
				);
		}
	};

	return (
		<AppShell
			active={ACTIVE_NAV[view]}
			siteId={siteId}
			online={live.online}
			picker={{
				loading: sitesQ.isLoading,
				onManage: () => setSitesOpen(true),
				onPick: pickSite,
				siteId,
				sites,
			}}
			onLinkAccount={() => onView("settings")}
			onAdmin={() => onView("admin")}
		>
			{/* A language switch remounts the content so every cached label re-renders. */}
			<div key={locale}>{renderView()}</div>
			<SitesView open={sitesOpen} onClose={() => setSitesOpen(false)} />
			{snippetOpen && site ? (
				<SnippetModal
					site={{ domain: site.domain, hasEvents: false, id: site.id }}
					onClose={() => setSnippetOpen(false)}
				/>
			) : null}
		</AppShell>
	);
};

export default AnalyticsPage;

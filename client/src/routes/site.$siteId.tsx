import { Capacitor } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "react-grid-layout";
import GridLayout, { useContainerWidth } from "react-grid-layout";
import type {
	ChannelEntry,
	DeviceEntry,
	EntryPageRevenue,
	Filter,
	FunnelStep,
	PageFunnel,
	RecordingDetail,
	RecordingSummary,
	RevenueByCountry,
	RevenueByPaymentMethod,
	RevenueByPaymentProvider,
	RevenueBySource,
	RevenueTimeSeriesPoint,
	SiteDashboard,
	SourceEntry,
	StatsChange,
	StatsResponse,
	TimeSeriesPoint,
	TopPage,
	VisitorJourney,
} from "shared";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { CampaignTable } from "@/components/dashboard/campaign-table";
import { DataTable } from "@/components/dashboard/data-table";
import { DeviceTable } from "@/components/dashboard/device-table";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { FunnelChartCustom } from "@/components/dashboard/funnel-chart";
import {
	GlobeEventLog,
	GlobeMarkerPopup,
	GlobeSummaryPanel,
} from "@/components/dashboard/globe";
import { HeatmapView } from "@/components/dashboard/heatmap";
import {
	CollapsibleSection,
	DEFAULT_LAYOUT,
	EmptyState,
	loadLayout,
	toMobileLayout,
} from "@/components/dashboard/helpers";
import { sourceLabel } from "@/components/dashboard/icons";
import { JourneyCard } from "@/components/dashboard/journey";
import { JourneySummaryTable } from "@/components/dashboard/journey-summary";
import { LocationTable } from "@/components/dashboard/location-table";
import { ChartCard, MetricCard } from "@/components/dashboard/metric-cards";
import { PredictionsWidget } from "@/components/dashboard/predictions-widget";
import { ProfilePanel } from "@/components/dashboard/profile-panel";
import {
	RecordingPanel,
	RecordingsTable,
} from "@/components/dashboard/recordings";
import {
	ChannelBreakdownWidget,
	RevenueBreakdownWidget,
} from "@/components/dashboard/revenue-widgets";
import { EventCalculator } from "@/components/event-calculator";
import { Globe, geoToMarkers } from "@/components/globe";
import { DateTimePicker } from "@/components/time-picker";
import {
	connectSSE,
	exportData,
	fetchDashboard,
	fetchFunnel,
	fetchGeo,
	fetchRecordings,
} from "@/lib/api";
import {
	encodeFilterString,
	matchesAllFilters,
	parseFilterString,
	toggleFilter,
} from "@/lib/filters";
import { t } from "@/lib/i18n";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export const Route = createFileRoute("/site/$siteId")({
	component: SiteDetailPage,
});

const RANGE_PRESETS = [
	{ key: "24h", label: "24h" },
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
];

function DashboardGrid({
	siteId,
	stats,
	compare,
	isLoading,
	timeseries,
	topPages,
	sources,
	devices,
	osData,
	browsersData,
	geoData,
	funnelSteps,
	funnelRate,
	funnelPages,
	journeys,
	allJourneys,
	hasFilters,
	selectedJourney,
	setSelectedJourney,
	onCrossFilter,
	recordings,
	onSelectRecording,
	range,
	filtersString,
	revenueBySource,
	revenueByCountry,
	revenueTimeseries,
	channels,
	entryPagesRevenue,
	revenueByMethod,
	revenueByProvider,
	editing,
	layout,
	onLayoutChange,
}: {
	siteId: string;
	stats?: StatsResponse;
	compare?: SiteDashboard["compare"];
	isLoading: boolean;
	timeseries: TimeSeriesPoint[];
	topPages: TopPage[];
	sources: SourceEntry[];
	devices: DeviceEntry[];
	osData: DeviceEntry[];
	browsersData: DeviceEntry[];
	geoData: {
		country: string | null;
		region: string | null;
		city: string | null;
		visitors: number;
	}[];
	funnelSteps: FunnelStep[];
	funnelRate: number;
	funnelPages: PageFunnel[];
	journeys: VisitorJourney[];
	allJourneys: VisitorJourney[];
	hasFilters: boolean;
	selectedJourney: VisitorJourney | null;
	setSelectedJourney: (j: VisitorJourney) => void;
	onCrossFilter: (dimension: string, value: string) => void;
	recordings: RecordingSummary[];
	onSelectRecording: (r: RecordingDetail) => void;
	range: string;
	filtersString: string;
	revenueBySource: RevenueBySource[];
	revenueByCountry: RevenueByCountry[];
	revenueTimeseries: RevenueTimeSeriesPoint[];
	channels: ChannelEntry[];
	entryPagesRevenue: EntryPageRevenue[];
	revenueByMethod: RevenueByPaymentMethod[];
	revenueByProvider: RevenueByPaymentProvider[];
	editing: boolean;
	layout: Layout;
	onLayoutChange: (layout: Layout) => void;
}) {
	const { width, containerRef, mounted } = useContainerWidth();

	// Rate-metric deltas (conv. rate, rev/visitor) computed from prev-period parts
	const rateChange = (
		curNum: number,
		curDen: number,
		prevNum: number | undefined,
		prevDen: number | undefined,
	): StatsChange | undefined => {
		if (prevNum === undefined || !prevDen) return undefined;
		const cur = curDen > 0 ? curNum / curDen : 0;
		const prev = prevNum / prevDen;
		if (prev === 0)
			return { current: cur, previous: 0, changePct: cur === 0 ? 0 : null };
		return {
			current: cur,
			previous: prev,
			changePct: Math.round(((cur - prev) / prev) * 100),
		};
	};
	const convRateChange = stats
		? rateChange(
				stats.conversions,
				stats.visitors,
				compare?.conversions?.previous,
				compare?.visitors?.previous,
			)
		: undefined;
	const revPerVisitorChange = stats
		? rateChange(
				stats.revenue,
				stats.visitors,
				compare?.revenue?.previous,
				compare?.visitors?.previous,
			)
		: undefined;

	const METRIC_KEYS = [
		"views",
		"visitors",
		"revenue",
		"conv",
		"rev_visitor",
		"bounce",
	] as const;
	const METRIC_LABELS: Record<string, string> = {
		views: t("metric.views"),
		visitors: t("metric.visitors"),
		revenue: t("metric.revenue"),
		conv: "Conv. rate",
		rev_visitor: "Rev/visitor",
		bounce: t("metric.bounce_rate"),
	};
	const [journeyView, setJourneyView] = useState<"summary" | "cards">(
		"summary",
	);
	const [hiddenMetrics, setHiddenMetrics] = useState<Set<string>>(() => {
		try {
			const s = localStorage.getItem("kp_hidden_metrics");
			return s ? new Set(JSON.parse(s)) : new Set();
		} catch {
			return new Set();
		}
	});
	const [showMetricsPopover, setShowMetricsPopover] = useState(false);
	const toggleMetric = (key: string) => {
		const next = new Set(hiddenMetrics);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setHiddenMetrics(next);
		try {
			localStorage.setItem("kp_hidden_metrics", JSON.stringify([...next]));
		} catch {
			/* ignore */
		}
	};
	const popoverRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!showMetricsPopover) return;
		const handler = (e: MouseEvent) => {
			if (popoverRef.current && !popoverRef.current.contains(e.target as Node))
				setShowMetricsPopover(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [showMetricsPopover]);

	const isMobile = width < 768;
	const gridCols = width < 520 ? 1 : width < 768 ? 2 : 12;
	const activeLayout = isMobile ? toMobileLayout(layout, gridCols) : layout;

	const widgetStyle = (_id: string) => ({
		background: "var(--bg2)",
		border: editing ? "1px dashed var(--accent)" : "1px solid var(--border)",
		borderRadius: 10,
		overflow: "hidden",
		cursor: editing ? "move" : "default",
		transition: "border-color 0.2s",
		display: "flex",
		flexDirection: "column" as const,
	});

	return (
		<div
			ref={containerRef}
			style={{
				flex: 1,
				overflowY: "auto",
				padding: isMobile ? "8px 10px 48px" : "16px 20px 48px",
			}}
		>
			{mounted && (
				<GridLayout
					layout={activeLayout}
					width={width}
					gridConfig={{
						cols: gridCols,
						rowHeight: 40,
						margin: isMobile ? ([8, 8] as const) : ([12, 12] as const),
						containerPadding: null,
						maxRows: Infinity,
					}}
					dragConfig={{ enabled: editing && !isMobile }}
					resizeConfig={{ enabled: editing && !isMobile }}
					onLayoutChange={isMobile ? undefined : onLayoutChange}
				>
					<div
						key="metrics"
						style={{
							...widgetStyle("metrics"),
							position: "relative",
							overflow: "visible",
						}}
					>
						<div
							className="metrics-grid"
							style={{ margin: 0, padding: "8px 14px" }}
						>
							{!hiddenMetrics.has("views") && (
								<MetricCard
									label={t("metric.views")}
									value={stats?.pageviews?.toLocaleString() ?? "0"}
									change={compare?.pageviews}
								/>
							)}
							{!hiddenMetrics.has("visitors") && (
								<MetricCard
									label={t("metric.visitors")}
									value={stats?.visitors?.toLocaleString() ?? "0"}
									change={compare?.visitors}
								/>
							)}
							{!hiddenMetrics.has("revenue") && (
								<MetricCard
									label={t("metric.revenue")}
									value={`$${(stats?.revenue ?? 0).toFixed(2)}`}
									change={compare?.revenue}
								/>
							)}
							{!hiddenMetrics.has("conv") && (
								<MetricCard
									label="Conv. rate"
									value={
										stats?.visitors
											? `${(((stats?.conversions ?? 0) / stats.visitors) * 100).toFixed(2)}%`
											: "0%"
									}
									change={convRateChange}
								/>
							)}
							{!hiddenMetrics.has("rev_visitor") && (
								<MetricCard
									label="Rev/visitor"
									value={
										stats?.visitors
											? `$${((stats?.revenue ?? 0) / stats.visitors).toFixed(2)}`
											: "$0"
									}
									change={revPerVisitorChange}
								/>
							)}
							{!hiddenMetrics.has("bounce") && (
								<MetricCard
									label={t("metric.bounce_rate")}
									value={`${stats?.bounceRate ?? 0}%`}
									change={compare?.bounceRate}
									invertChange
								/>
							)}
						</div>
						<div
							ref={popoverRef}
							style={{ position: "absolute", top: 6, right: 8, zIndex: 20 }}
						>
							<button
								type="button"
								onClick={() => setShowMetricsPopover(!showMetricsPopover)}
								style={{
									background: "none",
									border: "none",
									cursor: "pointer",
									color: "var(--text3)",
									fontSize: 14,
									padding: 2,
									lineHeight: 1,
								}}
							>
								...
							</button>
							{showMetricsPopover && (
								<div
									style={{
										position: "absolute",
										top: "100%",
										right: 0,
										background: "var(--bg2)",
										border: "1px solid var(--border)",
										borderRadius: 8,
										padding: "6px 0",
										minWidth: 140,
										boxShadow: "0 8px 24px rgba(0,0,0,.3)",
									}}
								>
									{METRIC_KEYS.map((key) => (
										<label
											key={key}
											style={{
												display: "flex",
												alignItems: "center",
												gap: 8,
												padding: "4px 12px",
												cursor: "pointer",
												fontSize: 12,
												color: hiddenMetrics.has(key)
													? "var(--text3)"
													: "var(--text)",
											}}
										>
											<input
												type="checkbox"
												checked={!hiddenMetrics.has(key)}
												onChange={() => toggleMetric(key)}
												style={{ accentColor: "var(--accent)" }}
											/>
											{METRIC_LABELS[key]}
										</label>
									))}
								</div>
							)}
						</div>
					</div>

					<div key="top-pages" style={widgetStyle("top-pages")}>
						<DataTable
							title={t("table.top_pages")}
							rows={topPages.map((p) => ({
								path: p.path,
								views: p.pageviews.toLocaleString(),
								visitors: p.visitors.toLocaleString(),
							}))}
							columns={[
								{ key: "path", label: t("table.page") },
								{
									key: "views",
									label: t("table.views"),
									align: "right",
									mono: true,
								},
								{
									key: "visitors",
									label: t("table.visitors"),
									align: "right",
									mono: true,
								},
							]}
							onRowClick={(row) => onCrossFilter("path", String(row.path))}
						/>
					</div>

					<div key="chart" style={widgetStyle("chart")}>
						<ChartCard
							data={timeseries}
							revenueTimeseries={revenueTimeseries}
							loading={isLoading}
						/>
					</div>

					<div key="sources" style={widgetStyle("sources")}>
						<DataTable
							title={t("table.traffic_sources")}
							rows={sources.map((s) => {
								const label = sourceLabel(s.source);
								return {
									source: label,
									_pct: `${s.percentage}%`,
									_raw_source: s.source,
								};
							})}
							columns={[
								{ key: "source", label: t("table.source") },
								{ key: "_pct", label: "Share", align: "right", mono: true },
							]}
							onRowClick={(row) =>
								onCrossFilter("utm_source", String(row._raw_source))
							}
						/>
					</div>

					<div key="locations" style={widgetStyle("locations")}>
						<LocationTable geoData={geoData} onCrossFilter={onCrossFilter} />
					</div>

					<div key="devices" style={widgetStyle("devices")}>
						<DeviceTable
							devices={devices}
							os={osData}
							browsers={browsersData}
							onCrossFilter={onCrossFilter}
						/>
					</div>

					<div key="funnel" style={widgetStyle("funnel")}>
						<FunnelChartCustom
							steps={funnelSteps}
							conversionRate={funnelRate}
							pages={funnelPages}
							onCrossFilter={onCrossFilter}
						/>
					</div>

					<div key="recordings" style={widgetStyle("recordings")}>
						<RecordingsTable
							recordings={recordings}
							onSelect={onSelectRecording}
						/>
					</div>

					<div key="journeys" style={widgetStyle("journeys")}>
						<div className="journeys-section" style={{ margin: 0 }}>
							<div className="journeys-header">
								<span className="journeys-title">{t("journeys.title")}</span>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<button
										type="button"
										className={`btn-pill ${journeyView === "summary" ? "active" : ""}`}
										onClick={() => setJourneyView("summary")}
										style={{ fontSize: 10, padding: "2px 8px" }}
										title="Table view"
									>
										&#9776;
									</button>
									<button
										type="button"
										className={`btn-pill ${journeyView === "cards" ? "active" : ""}`}
										onClick={() => setJourneyView("cards")}
										style={{ fontSize: 10, padding: "2px 8px" }}
										title="Card view"
									>
										&#9638;
									</button>
									<span className="journeys-count">
										{journeys.length}
										{hasFilters ? ` / ${allJourneys.length}` : ""}
									</span>
								</div>
							</div>
							{journeys.length === 0 ? (
								<div
									style={{
										padding: 20,
										color: "var(--text3)",
										fontSize: 13,
										textAlign: "center",
									}}
								>
									{t("journeys.no_activity")}
								</div>
							) : journeyView === "summary" ? (
								<JourneySummaryTable
									journeys={journeys}
									selectedJourney={selectedJourney}
									setSelectedJourney={setSelectedJourney}
								/>
							) : (
								<div className="journeys-list">
									{journeys.map((j) => (
										<JourneyCard
											key={j.session_id}
											journey={j}
											selected={selectedJourney?.session_id === j.session_id}
											onClick={() => setSelectedJourney(j)}
										/>
									))}
								</div>
							)}
						</div>
					</div>

					<div key="ai-insights" style={widgetStyle("ai-insights")}>
						<CollapsibleSection title="AI Insights" defaultOpen={false}>
							<AiInsightsCard siteId={siteId} range={range} />
						</CollapsibleSection>
					</div>

					<div key="event-usage" style={widgetStyle("event-usage")}>
						<CollapsibleSection
							title="Event Usage This Month"
							defaultOpen={false}
						>
							<EventCalculator
								currentEvents={
									(stats?.pageviews ?? 0) + (stats?.conversions ?? 0)
								}
								currentPlan="starter"
							/>
						</CollapsibleSection>
					</div>

					<div key="revenue" style={widgetStyle("revenue")}>
						<RevenueBreakdownWidget
							bySource={revenueBySource}
							byCountry={revenueByCountry}
							trend={revenueTimeseries}
							byMethod={revenueByMethod}
							byProvider={revenueByProvider}
							onCrossFilter={onCrossFilter}
							journeys={journeys}
							onSelectCustomer={setSelectedJourney}
						/>
					</div>

					<div key="channels" style={widgetStyle("channels")}>
						<div
							className="data-table-card"
							style={{
								border: "none",
								background: "transparent",
								display: "flex",
								flexDirection: "column",
								height: "100%",
							}}
						>
							<span className="data-table-title">Traffic Channels</span>
							<ChannelBreakdownWidget data={channels} />
						</div>
					</div>

					<div key="entry-pages" style={widgetStyle("entry-pages")}>
						<DataTable
							title="Entry Pages Revenue"
							rows={entryPagesRevenue.map((r) => ({
								path: r.path,
								sessions: r.sessions.toLocaleString(),
								conversions: r.conversions.toLocaleString(),
								revenue: `$${r.revenue.toFixed(2)}`,
								rate:
									r.sessions > 0
										? `${((r.conversions / r.sessions) * 100).toFixed(1)}%`
										: "0%",
							}))}
							columns={[
								{ key: "path", label: "Page" },
								{
									key: "sessions",
									label: "Sessions",
									align: "right",
									mono: true,
								},
								{
									key: "conversions",
									label: "Conv.",
									align: "right",
									mono: true,
								},
								{
									key: "revenue",
									label: "Revenue",
									align: "right",
									mono: true,
								},
								{ key: "rate", label: "Rate", align: "right", mono: true },
							]}
						/>
					</div>

					<div key="predictions" style={widgetStyle("predictions")}>
						<PredictionsWidget siteId={siteId} />
					</div>

					<div key="campaigns" style={widgetStyle("campaigns")}>
						<div
							style={{
								fontSize: 13,
								fontWeight: 600,
								marginBottom: 8,
								padding: "0 4px",
							}}
						>
							Campaign Performance
						</div>
						<CampaignTable
							siteId={siteId}
							range={range}
							filters={filtersString}
							onCrossFilter={onCrossFilter}
						/>
					</div>
				</GridLayout>
			)}
		</div>
	);
}

function SiteDetailPage() {
	const navigate = useNavigate();
	const { siteId } = Route.useParams();
	const queryClient = useQueryClient();
	const [range, setRange] = useState("7d");
	const [customStart, setCustomStart] = useState("");
	const [customEnd, setCustomEnd] = useState("");
	const [showCustom, setShowCustom] = useState(false);
	const [selectedJourney, setSelectedJourney] = useState<VisitorJourney | null>(
		null,
	);
	const [locationView, setLocationView] = useState<
		"cards" | "globe" | "heatmap"
	>("cards");
	const [selectedGlobeCity, setSelectedGlobeCity] = useState<string | null>(
		null,
	);
	const [filtersString, setFiltersString] = useState("");
	const [selectedRecording, setSelectedRecording] =
		useState<RecordingDetail | null>(null);
	const [editing, setEditing] = useState(false);
	const [layout, setLayout] = useState<Layout>(() => loadLayout(siteId));

	const onLayoutChange = useCallback(
		(newLayout: Layout) => {
			setLayout(newLayout);
			try {
				localStorage.setItem(`kp_layout_${siteId}`, JSON.stringify(newLayout));
			} catch {
				/* ignore */
			}
		},
		[siteId],
	);

	const effectiveRange =
		showCustom && customStart && customEnd
			? `${customStart},${customEnd}`
			: range;
	const activeFilters = parseFilterString(filtersString);
	const hasFilters = activeFilters.length > 0;

	const onCrossFilter = useCallback((dimension: string, value: string) => {
		setFiltersString((prev) => {
			const current = parseFilterString(prev);
			const rule: Filter = { dimension, operator: "is", value };
			return encodeFilterString(toggleFilter(current, rule));
		});
	}, []);

	const { data, isLoading } = useQuery({
		queryKey: ["dashboard", siteId, effectiveRange, filtersString],
		queryFn: () =>
			fetchDashboard(
				siteId,
				showCustom && customStart && customEnd ? undefined : range,
				showCustom ? customStart : undefined,
				showCustom ? customEnd : undefined,
				filtersString || undefined,
			),
		enabled: !!siteId,
	});

	const { data: funnelData } = useQuery({
		queryKey: ["funnel", siteId, effectiveRange, filtersString],
		queryFn: () =>
			fetchFunnel(
				siteId,
				showCustom && customStart && customEnd ? undefined : range,
				filtersString || undefined,
			),
		enabled: !!siteId,
	});

	const { data: geoData } = useQuery({
		queryKey: ["geo", siteId, effectiveRange, filtersString],
		queryFn: () =>
			fetchGeo(
				siteId,
				showCustom && customStart && customEnd ? undefined : range,
				filtersString || undefined,
			),
		enabled: !!siteId,
	});

	const { data: recordingsData } = useQuery({
		queryKey: ["recordings", siteId, effectiveRange],
		queryFn: () =>
			fetchRecordings(
				siteId,
				showCustom && customStart && customEnd ? undefined : range,
			),
		enabled: !!siteId,
	});

	useEffect(() => {
		if (!siteId) return;
		const disconnect = connectSSE(siteId, (ev) => {
			if (ev.type === "visitor") {
				queryClient.invalidateQueries({ queryKey: ["geo", siteId] });
			}
			if (ev.type === "stats") {
				queryClient.invalidateQueries({ queryKey: ["dashboard", siteId] });
			}
		});
		return disconnect;
	}, [siteId, queryClient]);

	useEffect(() => {
		if (!data || !Capacitor.isNativePlatform()) return;
		import("@/plugins/klikapa-widget-bridge")
			.then(({ KlikapaWidgetBridge }) => {
				KlikapaWidgetBridge.saveWidgetData({
					siteName: siteId,
					visitors: data.stats.visitors,
					pageviews: data.stats.pageviews,
					trend: 0,
					sparkline: [],
					updatedAt: new Date().toISOString(),
				});
			})
			.catch(() => {});
	}, [data, siteId]);

	const hasNoData = !isLoading && data && data.stats.pageviews === 0;
	const stats = data?.stats;
	const allJourneys = data?.journeys ?? [];
	const topPages = data?.topPages ?? [];
	const sources = data?.sources ?? [];
	const timeseries = data?.timeseries ?? [];
	const revenueBySource = data?.revenueBySource ?? [];
	const revenueByCountry = data?.revenueByCountry ?? [];
	const revenueTimeseries = data?.revenueTimeseries ?? [];
	const channels = data?.channels ?? [];
	const entryPagesRevenue = data?.entryPagesRevenue ?? [];
	const revenueByMethod = data?.revenueByMethod ?? [];
	const revenueByProvider = data?.revenueByProvider ?? [];

	const journeys = useMemo(() => {
		if (!hasFilters) return allJourneys;
		return allJourneys.filter((j) => {
			const journeyObj: Record<string, unknown> = {
				country: j.country,
				region: j.region,
				city: j.city,
				device_type: j.device_type,
				browser: j.browser,
				os: j.os,
				utm_source: j.utm_source,
				referrer: j.referrer,
			};
			// Path filter: check if any step matches
			const pathFilters = activeFilters.filter((f) => f.dimension === "path");
			const otherFilters = activeFilters.filter((f) => f.dimension !== "path");
			if (pathFilters.length > 0) {
				const hasMatchingStep = j.steps.some((s) =>
					pathFilters.every((f) => matchesAllFilters({ path: s.path }, [f])),
				);
				if (!hasMatchingStep) return false;
			}
			return matchesAllFilters(journeyObj, otherFilters);
		});
	}, [allJourneys, activeFilters, hasFilters]);

	const globeMarkers = useMemo(() => geoToMarkers(geoData ?? []), [geoData]);

	if (!siteId) {
		return (
			<div className="empty-state" style={{ flex: 1 }}>
				<p>{t("sites.select_site")}</p>
			</div>
		);
	}
	if (hasNoData) return <EmptyState siteId={siteId} />;

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<div className="range-bar">
				{RANGE_PRESETS.map((r) => (
					<button
						type="button"
						key={r.key}
						className={`btn-pill ${!showCustom && range === r.key ? "active" : ""}`}
						onClick={() => {
							setRange(r.key);
							setShowCustom(false);
						}}
					>
						{r.label}
					</button>
				))}
				<div
					style={{
						width: 1,
						height: 18,
						background: "var(--border)",
						margin: "0 2px",
					}}
				/>
				<button
					type="button"
					className={`btn-pill ${showCustom ? "active" : ""}`}
					onClick={() => setShowCustom(!showCustom)}
				>
					Custom
				</button>
				{showCustom && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							flexWrap: "wrap",
						}}
					>
						<DateTimePicker
							value={customStart}
							onChange={setCustomStart}
							placeholder="Start"
						/>
						<span
							style={{ fontSize: 12, color: "var(--text3)", margin: "0 2px" }}
						>
							&rarr;
						</span>
						<DateTimePicker
							value={customEnd}
							onChange={setCustomEnd}
							placeholder="End"
						/>
						{customStart && customEnd && (
							<button
								type="button"
								className="btn-accent"
								style={{ fontSize: 12, padding: "6px 14px" }}
								onClick={() => {}}
							>
								Apply
							</button>
						)}
					</div>
				)}
				<div style={{ flex: 1 }} />
				{editing && (
					<button
						type="button"
						className="btn-pill range-overflow-btn"
						style={{ fontSize: 11, padding: "4px 10px", color: "var(--text3)" }}
						onClick={() => {
							setLayout([...DEFAULT_LAYOUT] as unknown as Layout);
							localStorage.removeItem(`kp_layout_${siteId}`);
						}}
					>
						Reset Layout
					</button>
				)}
				<button
					type="button"
					className="btn-pill range-overflow-btn"
					style={{
						fontSize: 11,
						padding: "4px 10px",
						color: editing ? "var(--accent)" : "var(--text3)",
					}}
					onClick={() => setEditing(!editing)}
				>
					{editing ? "Done" : "Edit Layout"}
				</button>
				<button
					type="button"
					className="btn-pill range-overflow-btn"
					onClick={() => navigate({ to: "/import" })}
					title="Import data"
				>
					&uarr; Import
				</button>
				<button
					type="button"
					className="btn-pill range-overflow-btn"
					onClick={() => navigate({ to: "/docs/install" })}
					title="Install Guide"
				>
					Install
				</button>
				<button
					type="button"
					className="btn-pill range-overflow-btn"
					onClick={() => exportData(siteId, "events", "csv", range)}
					title="Export CSV"
				>
					&darr; CSV
				</button>
				<button
					type="button"
					className="btn-pill range-overflow-btn"
					onClick={() => navigate({ to: "/settings" })}
					title="Settings"
				>
					Settings
				</button>
				<div className="location-tabs">
					<button
						type="button"
						className={`location-tab ${locationView === "cards" ? "active" : ""}`}
						onClick={() => {
							setLocationView("cards");
							setSelectedGlobeCity(null);
						}}
					>
						Cards
					</button>
					<button
						type="button"
						className={`location-tab ${locationView === "globe" ? "active" : ""}`}
						onClick={() => {
							setLocationView("globe");
							setSelectedGlobeCity(null);
						}}
					>
						Globe
					</button>
					<button
						type="button"
						className={`location-tab ${locationView === "heatmap" ? "active" : ""}`}
						onClick={() => {
							setLocationView("heatmap");
							setSelectedGlobeCity(null);
						}}
					>
						Heatmap
					</button>
				</div>
			</div>

			<FilterBar filters={filtersString} onFiltersChange={setFiltersString} />

			{isLoading ? (
				<div
					style={{
						flex: 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<div className="spinner" />
				</div>
			) : locationView === "globe" ? (
				<div className="detail-scroll">
					<div className="globe-view-layout">
						<div className="globe-view-sidebar">
							<GlobeSummaryPanel journeys={journeys} />
							<GlobeEventLog journeys={journeys} />
						</div>
						<div className="globe-view-main">
							<div className="globe-header">
								<span className="globe-title">{t("table.locations")}</span>
								{geoData && (
									<span className="globe-count">
										{geoData
											.reduce((s: number, g) => s + g.visitors, 0)
											.toLocaleString()}{" "}
										visitors from {geoData.length} locations
									</span>
								)}
							</div>
							<div className="globe-canvas-wrap">
								<Globe
									markers={globeMarkers}
									paused={!!selectedGlobeCity}
									onMarkerClick={(marker) =>
										setSelectedGlobeCity(marker.city ?? null)
									}
								/>
							</div>
							{selectedGlobeCity && (
								<GlobeMarkerPopup
									city={selectedGlobeCity}
									journeys={journeys.filter(
										(j) => j.city === selectedGlobeCity,
									)}
									onClose={() => setSelectedGlobeCity(null)}
								/>
							)}
						</div>
					</div>
				</div>
			) : locationView === "heatmap" ? (
				<HeatmapView
					siteId={siteId}
					topPages={topPages}
					range={effectiveRange}
				/>
			) : (
				<DashboardGrid
					siteId={siteId}
					stats={stats}
					compare={data?.compare}
					isLoading={isLoading}
					timeseries={timeseries}
					topPages={topPages}
					sources={sources}
					devices={data?.devices ?? []}
					osData={data?.os ?? []}
					browsersData={data?.browsers ?? []}
					geoData={geoData ?? []}
					funnelSteps={funnelData?.steps ?? []}
					funnelRate={funnelData?.conversionRate ?? 0}
					funnelPages={funnelData?.pages ?? []}
					journeys={journeys}
					allJourneys={allJourneys}
					hasFilters={hasFilters}
					selectedJourney={selectedJourney}
					setSelectedJourney={setSelectedJourney}
					onCrossFilter={onCrossFilter}
					recordings={recordingsData ?? []}
					onSelectRecording={setSelectedRecording}
					range={range}
					filtersString={filtersString}
					revenueBySource={revenueBySource}
					revenueByCountry={revenueByCountry}
					revenueTimeseries={revenueTimeseries}
					channels={channels}
					entryPagesRevenue={entryPagesRevenue}
					revenueByMethod={revenueByMethod}
					revenueByProvider={revenueByProvider}
					editing={editing}
					layout={layout}
					onLayoutChange={onLayoutChange}
				/>
			)}

			{selectedJourney && (
				<ProfilePanel
					journey={selectedJourney}
					onClose={() => setSelectedJourney(null)}
				/>
			)}
			{selectedRecording && (
				<RecordingPanel
					recording={selectedRecording}
					onClose={() => setSelectedRecording(null)}
				/>
			)}
		</div>
	);
}

import { getLegacyUser } from "@/lib/legacy/api";
import { AdminView } from "./admin-view";
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
	ArrowDownUp,
	ArrowRight,
	Check,
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
	updateVisitor,
} from "@/lib/legacy/api";
import type {
	CampaignPerformance,
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
import { BillingView, SubscriptionBanner } from "./billing-view";
import {
	FILTER_DIMS,
	FILTER_OPS,
	RANGES,
	agoLabel,
	duration,
	fmt,
	fmtC,
	fmtPct,
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
	SortHint,
	StatTile,
	TrafficChart,
} from "./ui";
import { VisitorSheet } from "./visitors";

type ViewKey = "home" | "settings" | "share" | "billing" | "integrations" | "admin";
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
	const tabs = NAV_TABS.filter((t) => t.key !== "admin" || isAdmin);
	return (
		<nav
			role="tablist"
			aria-label="Sections"
			className={`bg-muted/70 flex max-w-full overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:overflow-visible ${
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

export const stepToEvent = (s: JourneyStep): VisitorEvent | null => {
	if (s.event_type === "pageview") {
		return { kind: "view", page: s.path, time: s.timestamp };
	}
	if (s.event_type === "conversion") {
		const p = parseProps(s.props);
		return {
			event: s.name ?? "conversion",
			kind: "conversion",
			props: p.length ? p : undefined,
			revenue: s.revenue ? money(s.revenue) : undefined,
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

export const profileToVisitor = (p: VisitorProfile, journeys: VisitorJourney[]): Visitor => {
	const mine = journeys
		.filter((j) => j.visitor_id === p.visitor_id)
		.toSorted((a, b) => a.started_at.localeCompare(b.started_at));
	const events = mine
		.flatMap((j) => j.steps.map(stepToEvent))
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
		spent: p.total_revenue > 0 ? money(p.total_revenue) : null,
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

const journeyChip = (s: JourneyStep): string => {
	if (s.event_type === "pageview") {
		return s.path || "/";
	}
	if (s.event_type === "conversion") {
		return `${s.name ?? "purchase"} ${money(s.revenue ?? 0)}`;
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
}: {
	loading: boolean;
	hasData: boolean;
	emptyText: string;
	children: ReactNode;
}) => {
	if (loading) {
		return <PanelMsg>Loading…</PanelMsg>;
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

	return (
		<Panel title="AI crawlers" hint={data ? `${fmt(data.totals.all)} hits` : undefined}>
			<PanelBody
				loading={crawlersQ.isLoading}
				hasData={(data?.totals.all ?? 0) > 0}
				emptyText="No crawler hits yet."
			>
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
			</PanelBody>
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
			<PanelBody loading={loading} hasData={rows.length > 0} emptyText="No data yet.">
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
			<PanelBody loading={loading} hasData={rows.length > 0} emptyText="No data yet.">
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
				return <PanelMsg>Loading…</PanelMsg>;
			}
			if (!globeMarkers.length) {
				return <PanelMsg>No geolocated cities in this range.</PanelMsg>;
			}
			return <GlobePanel markers={globeMarkers} />;
		}
		return (
			<PanelBody loading={geoQ.isLoading} hasData={rows.length > 0} emptyText="No data yet.">
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

const PlatformPanel = ({ dash, loading }: DashProps) => {
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
			<PanelBody loading={loading} hasData={sorted.length > 0} emptyText="No data yet.">
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
			return <PanelMsg>Loading…</PanelMsg>;
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
							{money(c.revenue)}
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
						glyph={
							<span
								className="grid size-4 shrink-0 place-items-center rounded-[5px] bg-(--money)/15 font-mono text-[9px] font-bold text-(--money)"
								aria-hidden
							>
								$
							</span>
						}
						label={r.label}
						value={money(r.value)}
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

const LIVE_FEED_MAX = 8;

interface LiveFeedItem {
	key: string;
	flag: string;
	path: string;
	source: string;
	at: number;
}

const LivePanel = ({
	domain,
	online,
	feed,
}: {
	domain: string | undefined;
	online: number | null;
	feed: LiveFeedItem[];
}) => (
	<Panel title="Live" hint="right now">
		<p className="mb-1.5 flex items-center gap-2 text-[13px]">
			<span className="relative flex size-2">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--up) opacity-50 motion-reduce:animate-none" />
				<span className="relative inline-flex size-2 rounded-full bg-(--up)" />
			</span>
			{online ?? "…"} visitors on {domain ?? "…"}
		</p>
		<div>
			<PanelBody loading={false} hasData={feed.length > 0} emptyText="Waiting for live events…">
				<div>
					{feed.map((v) => (
						<div
							key={v.key}
							className="border-border/60 flex items-center gap-3 border-t py-1.5 text-[13px] first:border-t-0"
						>
							<span aria-hidden>{v.flag || "🌐"}</span>
							<span className="min-w-0 flex-1 truncate font-mono text-xs">{v.path}</span>
							<span className="text-muted-foreground hidden truncate text-xs sm:block">
								{v.source}
							</span>
							<span className="text-muted-foreground w-10 text-end font-mono text-xs tabular-nums">
								{agoLabel(new Date(v.at).toISOString())}
							</span>
						</div>
					))}
				</div>
			</PanelBody>
		</div>
	</Panel>
);

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
				.map((p) => profileToVisitor(p, journeys))
				.filter((v) =>
					pathPrefix
						? v.events.some(
								(e) => e.page === pathPrefix || (e.page?.startsWith(`${pathPrefix}/`) ?? false),
							)
						: true,
				)
				.toSorted((a, b) => (exploreSort === "events" ? b.events.length - a.events.length : 0)),
		[visitorsQ.data, journeys, exploreSort, pathPrefix],
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
							pathPrefix ? `No identified visitors touch ${pathPrefix}.` : "No visitors yet."
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
								const chips = realSteps.slice(0, 6).map(journeyChip);
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
												{money(j.total_revenue)}
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

const FunnelSection = ({
	siteId,
	rangeKey,
	filterStr,
}: {
	siteId: string;
	rangeKey: RangeKey;
	filterStr: string;
}) => {
	const [funnelPath, setFunnelPath] = useState("");
	const funnelQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchFunnel(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "funnel", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
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
				<span className="text-muted-foreground shrink-0 text-xs">data-section scroll funnel</span>
			</div>
			<PanelBody
				loading={funnelQ.isLoading}
				hasData={funnelSteps.length > 0}
				emptyText="No funnel data — needs pageview + scroll_section events."
			>
				<FunnelChart rate={funnelRate} steps={funnelSteps} />
			</PanelBody>
		</section>
	);
};

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
	<header className="border-border/60 bg-background/85 sticky top-0 z-20 border-b backdrop-blur">
		<div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-2 md:px-4">
			<Link
				to="/analytics"
				aria-label="revklik — all sites"
				title="All sites"
				className="hover:bg-accent focus-visible:outline-ring -m-1 flex items-center gap-2.5 rounded-lg p-1 outline-offset-2 transition-colors"
			>
				<img
					src="/revklik.webp"
					alt="Revklik logo"
					className="ring-foreground/10 size-7 rounded-lg object-cover ring-1"
				/>
				<span className="text-[15px] font-semibold tracking-tight">revklik</span>
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
				<div className="ms-auto flex items-center gap-2">
					<div className="bg-muted/70 flex rounded-full p-1">
						{RANGES.map((r) => (
							<button
								key={r.key}
								type="button"
								aria-pressed={rangeKey === r.key}
								onClick={() => onRange(r.key)}
								className={`focus-visible:outline-ring rounded-full px-2.5 py-1 text-[13px] font-medium outline-offset-2 focus-visible:outline-2 ${
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
						className="ring-foreground/10 bg-card hover:bg-accent size-7 rounded-full ring-1"
					>
						<Download className={`size-3.5 ${exporting ? "animate-pulse" : ""}`} aria-hidden />
					</Button>
					<span className="bg-card ring-foreground/10 hidden items-center gap-2 rounded-full px-2.5 py-1 text-[13px] ring-1 sm:flex">
						<span className="relative flex size-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--up) opacity-50 motion-reduce:animate-none" />
							<span className="relative inline-flex size-2 rounded-full bg-(--up)" />
						</span>
						{online ?? "…"} online
					</span>
				</div>
			) : null}

			<NavTabs
				view={view}
				onView={onView}
				className="order-last w-full min-w-0 justify-start sm:justify-center md:absolute md:top-1/2 md:left-1/2 md:order-none md:w-auto md:min-w-fit md:-translate-x-1/2 md:-translate-y-1/2"
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
	deltaPct,
}: {
	stats: SiteDashboard["stats"] | undefined;
	deltaPct: (k: keyof NonNullable<SiteDashboard["compare"]>) => number;
}) => (
	<div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
		<StatTile
			label="Visitors"
			value={stats ? fmt(stats.visitors) : "…"}
			delta={fmtPct(deltaPct("visitors"))}
			tone={deltaPct("visitors") >= 0 ? "good" : "bad"}
		/>
		<StatTile
			label="Pageviews"
			value={stats ? fmt(stats.pageviews) : "…"}
			delta={fmtPct(deltaPct("pageviews"))}
			tone={deltaPct("pageviews") >= 0 ? "good" : "bad"}
		/>
		<StatTile
			label="Bounce rate"
			value={stats ? `${stats.bounceRate.toFixed(1)}%` : "…"}
			delta={fmtPct(deltaPct("bounceRate"))}
			tone={deltaPct("bounceRate") <= 0 ? "good" : "bad"}
		/>
		<StatTile
			label="Visit duration"
			value={stats ? duration(stats.avgDuration) : "…"}
			delta={fmtPct(deltaPct("avgDuration"))}
			tone={deltaPct("avgDuration") >= 0 ? "good" : "bad"}
		/>
		<StatTile
			label="Revenue"
			value={stats ? money(stats.revenue) : "…"}
			delta={fmtPct(deltaPct("revenue"))}
			tone={deltaPct("revenue") >= 0 ? "good" : "bad"}
		/>
	</div>
);

/* --------------------------------- page ------------------------------------ */

const AnalyticsPage = ({ siteId: siteIdParam }: { siteId: string }) => {
	const navigate = useNavigate();
	const [view, setView] = useState<ViewKey>("home");
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
			return profileToVisitor(local, dash?.journeys ?? NO_JOURNEYS);
		}
		return sheetFetched?.profile.visitor_id === visitorSheetId
			? profileToVisitor(sheetFetched.profile, sheetFetched.journeys)
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
		return connectSSE(siteId, ({ type, data }) => {
			if (type === "stats") {
				const d = data as { live_visitors?: number };
				setLive((s) => ({ ...s, online: d.live_visitors ?? s.online }));
			} else if (type === "visitor") {
				const d = data as {
					path?: string;
					country?: string;
					referrer?: string;
					utm_source?: string;
					ts?: number;
				};
				setLive((s) => ({
					...s,
					feed: [
						{
							at: Date.now(),
							flag: countryFlag(d.country),
							key: `${d.ts ?? Date.now()}-${d.path ?? ""}`,
							path: d.path ?? "/",
							source: d.utm_source || hostOf(d.referrer) || "direct",
						},
						...s.feed,
					].slice(0, LIVE_FEED_MAX),
				}));
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
		void navigate({ to: "/analytics/$siteId", params: { siteId: id } });
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
	const deltaPct = (k: keyof NonNullable<SiteDashboard["compare"]>): number =>
		cmp?.[k]?.changePct ?? 0;

	const firstError = [sitesQ.error, dashQ.error].find(Boolean);
	const errorMsg = firstError instanceof Error ? firstError.message : "";

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

			{view === "home" ? (
				<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
					<SubscriptionBanner onUpgrade={() => setView("billing")} />
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

					<StatTiles stats={stats} deltaPct={deltaPct} />
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
								<span className="text-muted-foreground font-mono text-xs tabular-nums">
									{points[0]?.full}
									{points.length > 1 ? ` – ${points.at(-1)?.full}` : ""}
								</span>
							</span>
						</div>
						<PanelBody
							loading={loadingDash}
							hasData={points.length > 0}
							emptyText="No traffic in this range."
						>
							<TrafficChart points={points} annotations={annotations} revenue={revenueSeries} />
						</PanelBody>
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
						<CrawlersPanel siteId={siteId} rangeKey={rangeKey} />
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
						<PredictionsPanel
							onOpenVisitor={openVisitorSheet}
							onUpgrade={() => setView("billing")}
							siteId={siteId}
						/>
					</div>
					<FunnelSection siteId={siteId} rangeKey={rangeKey} filterStr={filterStr} />
				</main>
			) : view === "share" ? (
				<ShareWidgetTokensView />
			) : view === "billing" ? (
				<BillingView />
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

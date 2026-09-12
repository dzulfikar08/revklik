import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { FunnelChart, FunnelPageTabs } from "@/components/analytics/funnel-chart";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import {
	CountBarRow,
	Panel,
	PanelBody,
	PanelMsg,
	PanelTabs,
	SortHint,
	StatTile,
} from "@/components/analytics/ui";
import { selectActiveSite, useActiveSite } from "@/lib/active-site";
import { RANGES, duration, fmt, fmtC, fmtPct, money, pointLabel } from "@/lib/analytics-data";
import type { CountRow, RangeKey } from "@/lib/analytics-data";
import { aggregateGeo, hostOf } from "@/lib/analytics-transform";
import {
	connectSSE,
	countryFlag,
	fetchCampaigns,
	fetchDashboard,
	fetchFunnel,
	fetchGeo,
	fetchSites,
} from "@/lib/klikapa/api";
import type { SiteDashboard } from "@/lib/klikapa/api";

type PageTabKey = "pages" | "entry" | "exit";
type SourceTabKey = "channel" | "referrer";
type LocationTabKey = "city" | "country" | "region";
type PlatformTabKey = "browser" | "device" | "os";
type RevenueTabKey = "campaign" | "country" | "method" | "source";

const LIVE_FEED_MAX = 8;

interface LiveFeedItem {
	key: string;
	flag: string;
	path: string;
	source: string;
	at: number;
}

type DeviceIcon = "desktop-outline" | "phone-portrait-outline" | "tablet-landscape-outline";

const deviceGlyph = (device: string): DeviceIcon => {
	const d = device.toLowerCase();
	if (d.includes("mobile") || d.includes("phone")) {
		return "phone-portrait-outline";
	}
	if (d.includes("tablet")) {
		return "tablet-landscape-outline";
	}
	return "desktop-outline";
};

const sortRows = (rows: CountRow[], dir: "asc" | "desc"): CountRow[] =>
	rows.toSorted((a, b) => (dir === "desc" ? b.value - a.value : a.value - b.value));

const rowsTotal = (rows: CountRow[]): number => rows.reduce((acc, r) => acc + r.value, 0);

const IoniconGlyph = ({ icon }: { icon: DeviceIcon }) => {
	const { theme } = useUnistyles();
	return <Ionicons color={theme.colors.mutedForeground} name={icon} size={15} />;
};

/* ------------------------------- chips rows -------------------------------- */

const ChipsRow = ({
	items,
	value,
	onChange,
}: {
	items: readonly { key: string; label: string }[];
	value: string;
	onChange: (key: string) => void;
}) => (
	<ScrollView
		horizontal
		contentContainerStyle={styles.chipsTrack}
		showsHorizontalScrollIndicator={false}
	>
		{items.map((r) => {
			const active = value === r.key;
			return (
				<TouchableOpacity
					key={r.key}
					onPress={() => onChange(r.key)}
					style={[styles.chip, active && styles.chipActive]}
				>
					<Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{r.label}</Text>
				</TouchableOpacity>
			);
		})}
	</ScrollView>
);

/* -------------------------------- breakdowns ------------------------------- */

const BarList = ({
	rows,
	dir,
	asMoney = false,
}: {
	rows: CountRow[];
	dir: "asc" | "desc";
	asMoney?: boolean;
}) => {
	const total = rowsTotal(rows);
	return (
		<View>
			{sortRows(rows, dir).map((r) => (
				<CountBarRow
					key={r.label}
					fill={asMoney ? "#E1B850" : undefined}
					glyph={r.flag ? <Text style={styles.barGlyph}>{r.flag}</Text> : undefined}
					label={r.label}
					share={(r.value / total) * 100}
					value={asMoney ? money(r.value) : fmtC(r.value)}
				/>
			))}
		</View>
	);
};

interface DashProps {
	dash: SiteDashboard | undefined;
	loading: boolean;
}

const PagesPanel = ({ dash, loading }: DashProps) => {
	const [tab, setTab] = useState<PageTabKey>("pages");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const rows: CountRow[] = useMemo(() => {
		if (tab === "entry") {
			return (dash?.entryPagesRevenue ?? []).map((p) => ({
				label: p.path,
				value: p.sessions,
			}));
		}
		if (tab === "exit") {
			return (dash?.exitPages ?? []).map((p) => ({
				label: p.path,
				value: p.exits,
			}));
		}
		return (dash?.topPages ?? []).map((p) => ({
			label: p.path,
			value: p.pageviews,
		}));
	}, [dash, tab]);

	return (
		<Panel
			hint={
				<SortHint
					dir={dir}
					label="views"
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
			tabs={
				<PanelTabs
					onChange={(k) => setTab(k as PageTabKey)}
					tabs={[
						{ key: "pages", label: "Pages" },
						{ key: "entry", label: "Entry" },
						{ key: "exit", label: "Exit" },
					]}
					value={tab}
				/>
			}
		>
			<PanelBody emptyText="No data yet." hasData={rows.length > 0} loading={loading}>
				<BarList dir={dir} rows={rows} />
			</PanelBody>
		</Panel>
	);
};

const SourcesPanel = ({ dash, loading }: DashProps) => {
	const [tab, setTab] = useState<SourceTabKey>("referrer");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const rows: CountRow[] = useMemo(() => {
		if (tab === "channel") {
			return (dash?.channels ?? []).map((c) => ({
				label: c.channel,
				value: c.visitors,
			}));
		}
		return (dash?.sources ?? []).map((s) => ({
			label: s.source,
			value: s.visitors,
		}));
	}, [dash, tab]);

	return (
		<Panel
			hint={
				<SortHint
					dir={dir}
					label="visitors"
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
			tabs={
				<PanelTabs
					onChange={(k) => setTab(k as SourceTabKey)}
					tabs={[
						{ key: "referrer", label: "Referrer" },
						{ key: "channel", label: "Channel" },
					]}
					value={tab}
				/>
			}
		>
			<PanelBody emptyText="No data yet." hasData={rows.length > 0} loading={loading}>
				<BarList dir={dir} rows={rows} />
			</PanelBody>
		</Panel>
	);
};

const LocationPanel = ({ siteId, rangeKey }: { siteId: string; rangeKey: RangeKey }) => {
	const [tab, setTab] = useState<LocationTabKey>("country");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const geoQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchGeo(siteId, rangeKey, ""),
		queryKey: ["legacy", "geo", siteId, rangeKey, ""],
	});
	const rows: CountRow[] = useMemo(() => {
		const geo = geoQ.data ?? [];
		if (tab === "region") {
			return aggregateGeo(geo, (r) => r.region);
		}
		if (tab === "city") {
			return aggregateGeo(geo, (r) => r.city);
		}
		return aggregateGeo(geo, (r) => r.country);
	}, [geoQ.data, tab]);

	return (
		<Panel
			hint={
				<SortHint
					dir={dir}
					label="visitors"
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
			tabs={
				<PanelTabs
					onChange={(k) => setTab(k as LocationTabKey)}
					tabs={[
						{ key: "country", label: "Countries" },
						{ key: "region", label: "Region" },
						{ key: "city", label: "City" },
					]}
					value={tab}
				/>
			}
		>
			<PanelBody emptyText="No data yet." hasData={rows.length > 0} loading={geoQ.isLoading}>
				<BarList dir={dir} rows={rows} />
			</PanelBody>
		</Panel>
	);
};

const PlatformPanel = ({ dash, loading }: DashProps) => {
	const [tab, setTab] = useState<PlatformTabKey>("device");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const rows: CountRow[] = useMemo(() => {
		let src = dash?.devices;
		if (tab === "browser") {
			src = dash?.browsers;
		}
		if (tab === "os") {
			src = dash?.os;
		}
		return (src ?? []).map((d) => ({ label: d.device, value: d.visitors }));
	}, [dash, tab]);
	const total = rowsTotal(rows);

	return (
		<Panel
			hint={
				<SortHint
					dir={dir}
					label="Visitors"
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
			tabs={
				<PanelTabs
					onChange={(k) => setTab(k as PlatformTabKey)}
					tabs={[
						{ key: "device", label: "Device" },
						{ key: "browser", label: "Browser" },
						{ key: "os", label: "OS" },
					]}
					value={tab}
				/>
			}
		>
			<PanelBody emptyText="No data yet." hasData={rows.length > 0} loading={loading}>
				{sortRows(rows, dir).map((d) => (
					<CountBarRow
						key={d.label}
						glyph={
							tab === "device" ? (
								<IoniconGlyph icon={deviceGlyph(d.label)} />
							) : (
								<View style={styles.neutralGlyph} />
							)
						}
						label={d.label}
						share={(d.value / total) * 100}
						value={fmtC(d.value)}
					/>
				))}
			</PanelBody>
		</Panel>
	);
};

const RevenuePanel = ({
	dash,
	loading,
	siteId,
	rangeKey,
}: DashProps & { siteId: string; rangeKey: RangeKey }) => {
	const [tab, setTab] = useState<RevenueTabKey>("source");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const campaignsQ = useQuery({
		enabled: Boolean(siteId) && tab === "campaign",
		// The worker predates this endpoint (404) — fetchCampaigns already
		// degrades that to "no campaigns".
		queryFn: () => fetchCampaigns(siteId, rangeKey, ""),
		queryKey: ["legacy", "campaigns", siteId, rangeKey, ""],
	});

	const rows: CountRow[] = useMemo(() => {
		if (tab === "country") {
			return (dash?.revenueByCountry ?? []).map((r) => ({
				flag: countryFlag(r.country) || undefined,
				label: r.country,
				value: r.revenue,
			}));
		}
		if (tab === "method") {
			return (dash?.revenueByMethod ?? []).map((r) => ({
				label: r.method,
				value: r.revenue,
			}));
		}
		return (dash?.revenueBySource ?? []).map((r) => ({
			label: r.source,
			value: r.revenue,
		}));
	}, [dash, tab]);

	return (
		<Panel
			hint={
				<SortHint
					dir={dir}
					label="revenue"
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
			tabs={
				<PanelTabs
					onChange={(k) => setTab(k as RevenueTabKey)}
					tabs={[
						{ key: "source", label: "Source" },
						{ key: "country", label: "Country" },
						{ key: "method", label: "Method" },
						{ key: "campaign", label: "Campaign" },
					]}
					value={tab}
				/>
			}
		>
			{tab === "campaign" ? (
				<PanelBody
					emptyText="No campaigns recorded."
					hasData={(campaignsQ.data ?? []).length > 0}
					loading={campaignsQ.isLoading}
				>
					{(campaignsQ.data ?? []).map((c) => (
						<View
							key={`${c.utm_source}-${c.utm_medium}-${c.utm_campaign}`}
							style={styles.campaignRow}
						>
							<View style={styles.campaignMain}>
								<Text numberOfLines={1} style={styles.campaignName}>
									{c.utm_campaign || "(none)"}
								</Text>
								<Text numberOfLines={1} style={styles.campaignMeta}>
									{c.utm_source || "—"} · {c.utm_medium || "—"} · {c.conversionRate}% convert
								</Text>
							</View>
							<Text style={styles.campaignVisitors}>{fmt(c.visitors)}</Text>
							<Text style={[styles.campaignRevenue, { color: "#E1B850" }]}>{money(c.revenue)}</Text>
						</View>
					))}
				</PanelBody>
			) : (
				<PanelBody
					emptyText="No revenue in this range."
					hasData={rows.length > 0}
					loading={loading}
				>
					<BarList asMoney dir={dir} rows={rows} />
				</PanelBody>
			)}
		</Panel>
	);
};

/* --------------------------------- live ------------------------------------ */

const LivePanel = ({
	domain,
	online,
	feed,
}: {
	domain: string | undefined;
	online: number | null;
	feed: LiveFeedItem[];
}) => {
	const { theme } = useUnistyles();
	return (
		<Panel title="Live" hint="right now">
			<View style={styles.liveRow}>
				<View style={[styles.liveDot, { backgroundColor: theme.colors.up }]} />
				<Text style={styles.liveText}>
					{online ?? "…"} visitors on {domain ?? "…"}
				</Text>
			</View>
			<PanelBody emptyText="Waiting for live events…" hasData={feed.length > 0} loading={false}>
				{feed.map((v) => (
					<View key={v.key} style={styles.liveItem}>
						<Text style={styles.liveFlag}>{v.flag || "🌐"}</Text>
						<Text numberOfLines={1} style={styles.livePath}>
							{v.path}
						</Text>
						<Text style={styles.liveSource}>{v.source}</Text>
					</View>
				))}
			</PanelBody>
		</Panel>
	);
};

/* ------------------------------- stat tiles -------------------------------- */

const StatTiles = ({
	stats,
	deltaPct,
}: {
	stats: SiteDashboard["stats"] | undefined;
	deltaPct: (k: keyof NonNullable<SiteDashboard["compare"]>) => number;
}) => (
	<View style={styles.tilesGrid}>
		<StatTile
			delta={fmtPct(deltaPct("visitors"))}
			label="Visitors"
			tone={deltaPct("visitors") >= 0 ? "good" : "bad"}
			value={stats ? fmt(stats.visitors) : "…"}
		/>
		<StatTile
			delta={fmtPct(deltaPct("pageviews"))}
			label="Pageviews"
			tone={deltaPct("pageviews") >= 0 ? "good" : "bad"}
			value={stats ? fmt(stats.pageviews) : "…"}
		/>
		<StatTile
			delta={fmtPct(deltaPct("bounceRate"))}
			label="Bounce rate"
			tone={deltaPct("bounceRate") <= 0 ? "good" : "bad"}
			value={stats ? `${stats.bounceRate.toFixed(1)}%` : "…"}
		/>
		<StatTile
			delta={fmtPct(deltaPct("avgDuration"))}
			label="Visit duration"
			tone={deltaPct("avgDuration") >= 0 ? "good" : "bad"}
			value={stats ? duration(stats.avgDuration) : "…"}
		/>
		<StatTile
			delta={fmtPct(deltaPct("revenue"))}
			label="Revenue"
			tone={deltaPct("revenue") >= 0 ? "good" : "bad"}
			value={stats ? money(stats.revenue) : "…"}
		/>
	</View>
);

/* --------------------------------- funnel ---------------------------------- */

const FunnelSection = ({ siteId, rangeKey }: { siteId: string; rangeKey: RangeKey }) => {
	const [funnelPath, setFunnelPath] = useState("");
	const funnelQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchFunnel(siteId, rangeKey, ""),
		queryKey: ["legacy", "funnel", siteId, rangeKey, ""],
	});
	const funnel = funnelQ.data;
	const funnelPage = funnel?.pages.find((p) => p.path === funnelPath) ?? funnel?.pages[0];
	const funnelSteps = funnelPage?.steps ?? funnel?.steps ?? [];
	const funnelRate = funnelPage?.conversionRate ?? funnel?.conversionRate ?? 0;
	const activePath = funnelPage?.path ?? "";

	return (
		<Panel title={funnel?.pages.length ? undefined : "Scroll funnel"}>
			{funnel?.pages.length ? (
				<FunnelPageTabs active={activePath} onPick={setFunnelPath} pages={funnel.pages} />
			) : null}
			<PanelBody
				emptyText="No funnel data — needs pageview + scroll_section events."
				hasData={funnelSteps.length > 0}
				loading={funnelQ.isLoading}
			>
				<FunnelChart rate={funnelRate} steps={funnelSteps} />
			</PanelBody>
		</Panel>
	);
};

/* --------------------------------- dashboard ------------------------------- */

export const DashboardView = () => {
	const { theme } = useUnistyles();
	const activeSite = useActiveSite();
	const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
	const [live, setLive] = useState<{
		feed: LiveFeedItem[];
		online: number | null;
	}>({
		feed: [],
		online: null,
	});

	const sitesQ = useQuery({
		// Keep the previous list visible while a new range loads.
		placeholderData: (prev) => prev,
		queryFn: () => fetchSites(rangeKey),
		queryKey: ["legacy", "sites", rangeKey],
	});
	const sites = sitesQ.data ?? [];
	const siteId = sites.some((s) => s.id === activeSite) ? (activeSite ?? "") : (sites[0]?.id ?? "");
	const site = sites.find((s) => s.id === siteId);

	const dashQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchDashboard(siteId, rangeKey, ""),
		queryKey: ["legacy", "dash", siteId, rangeKey, ""],
	});
	const dash = dashQ.data;
	const loadingDash = dashQ.isLoading;

	useEffect(() => {
		if (!siteId) {
			return;
		}
		return connectSSE(siteId, ({ data, type }) => {
			if (type === "stats") {
				const d = data as { live_visitors?: number };
				setLive((s) => ({ ...s, online: d.live_visitors ?? s.online }));
			} else if (type === "visitor") {
				const d = data as {
					country?: string;
					path?: string;
					referrer?: string;
					ts?: number;
					utm_source?: string;
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
	const points = useMemo(
		() =>
			(dash?.timeseries ?? []).map((t) => ({
				...pointLabel(t.date, hourly),
				current: t.visitors,
				date: t.date,
			})),
		[dash, hourly],
	);

	const stats = dash?.stats;
	const cmp = dash?.compare;
	const deltaPct = (k: keyof NonNullable<SiteDashboard["compare"]>): number =>
		cmp?.[k]?.changePct ?? 0;

	const firstError = [sitesQ.error, dashQ.error].find(Boolean);
	const errorMsg = firstError instanceof Error ? firstError.message : "";

	let content: ReactNode;
	if (sitesQ.isLoading) {
		content = <Text style={styles.loadingText}>Loading sites…</Text>;
	} else if (sites.length === 0) {
		content = <PanelMsg>No sites yet — add one on the Sites tab.</PanelMsg>;
	} else {
		content = (
			<>
				<StatTiles deltaPct={deltaPct} stats={stats} />

				<Panel>
					<View style={styles.chartHead}>
						<View style={styles.legendRow}>
							<View style={[styles.legendSwatch, { backgroundColor: theme.colors.chart }]} />
							<Text style={styles.legendText}>Visitors</Text>
						</View>
						<Text style={styles.rangeLabel}>
							{points[0]?.full}
							{points.length > 1 ? ` – ${points.at(-1)?.full}` : ""}
						</Text>
					</View>
					<PanelBody
						emptyText="No traffic in this range."
						hasData={points.length > 0}
						loading={loadingDash}
					>
						<TrafficChart points={points} />
					</PanelBody>
				</Panel>

				<PagesPanel dash={dash} loading={loadingDash} />
				<SourcesPanel dash={dash} loading={loadingDash} />
				<LocationPanel rangeKey={rangeKey} siteId={siteId} />
				<PlatformPanel dash={dash} loading={loadingDash} />
				<RevenuePanel dash={dash} loading={loadingDash} rangeKey={rangeKey} siteId={siteId} />
				<LivePanel domain={site?.domain} feed={live.feed} online={live.online} />
				<FunnelSection rangeKey={rangeKey} siteId={siteId} />
			</>
		);
	}

	return (
		<ScrollView
			contentContainerStyle={styles.page}
			style={{ backgroundColor: theme.colors.background }}
		>
			<ChipsRow
				items={sites.map((s) => ({ key: s.id, label: s.domain }))}
				onChange={(key) => {
					selectActiveSite(key);
					setLive({ feed: [], online: null });
				}}
				value={siteId}
			/>
			<ChipsRow items={RANGES} onChange={(k) => setRangeKey(k as RangeKey)} value={rangeKey} />

			{errorMsg ? (
				<View style={[styles.errorBanner, { backgroundColor: `${theme.colors.down}1A` }]}>
					<Text style={[styles.errorText, { color: theme.colors.down }]}>{errorMsg}</Text>
				</View>
			) : null}

			{content}
		</ScrollView>
	);
};

const styles = StyleSheet.create((theme) => ({
	barGlyph: {
		fontSize: 14,
	},
	campaignMain: {
		flexShrink: 1,
	},
	campaignMeta: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	campaignName: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "500",
	},
	campaignRevenue: {
		fontFamily: "monospace",
		fontSize: 12,
	},
	campaignRow: {
		alignItems: "center",
		borderColor: theme.colors.border,
		borderTopWidth: 1,
		flexDirection: "row",
		gap: 10,
		paddingVertical: 7,
	},
	campaignVisitors: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 12,
	},
	chartHead: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		justifyContent: "space-between",
		marginBottom: 8,
	},
	chip: {
		alignItems: "center",
		backgroundColor: theme.colors.muted,
		borderColor: theme.colors.border,
		borderRadius: 999,
		borderWidth: 1,
		flexDirection: "row",
		gap: 6,
		paddingHorizontal: 11,
		paddingVertical: 6,
	},
	chipActive: {
		backgroundColor: theme.colors.popover,
	},
	chipLabel: {
		color: theme.colors.mutedForeground,
		fontSize: 13,
		fontWeight: "500",
	},
	chipLabelActive: {
		color: theme.colors.foreground,
	},
	chipsTrack: {
		gap: 6,
		paddingVertical: 2,
	},
	errorBanner: {
		borderRadius: theme.borderRadius.lg,
		paddingHorizontal: 12,
		paddingVertical: 8,
	},
	errorText: {
		fontSize: theme.fontSize.xs,
	},
	legendRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 6,
	},
	legendSwatch: {
		borderRadius: 999,
		height: 3,
		width: 16,
	},
	legendText: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
	},
	liveDot: {
		borderRadius: 999,
		height: 8,
		width: 8,
	},
	liveFlag: {
		fontSize: 14,
	},
	liveItem: {
		alignItems: "center",
		borderColor: theme.colors.border,
		borderTopWidth: 1,
		flexDirection: "row",
		gap: 8,
		paddingVertical: 6,
	},
	livePath: {
		color: theme.colors.foreground,
		flex: 1,
		fontFamily: "monospace",
		fontSize: 11,
	},
	liveRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 8,
		marginBottom: 6,
	},
	liveSource: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	liveText: {
		color: theme.colors.foreground,
		fontSize: 13,
	},
	loadingText: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		textAlign: "center",
	},
	neutralGlyph: {
		backgroundColor: theme.colors.border,
		borderRadius: 4,
		height: 14,
		width: 14,
	},
	page: {
		gap: 10,
		padding: 12,
		paddingBottom: 32,
	},
	rangeLabel: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
	},
	tilesGrid: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
	},
}));

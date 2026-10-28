import { FileText, Globe, Monitor, Smartphone, Tablet } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { CountBarRow, Panel, PanelTabs, StatTile, TrafficChart } from "@/components/analytics/ui";
import { RANGES, fmt, fmtC, money, pointLabel } from "@/components/analytics/data";
import type { Point, RangeKey } from "@/components/analytics/data";
import { useT } from "@/lib/i18n";

/**
 * The public dashboard view shared by /public/:token (live API data) and
 * /demo (seeded fixture). It renders from props only: where the numbers come
 * from is the route's business, never this component's.
 */

/* --------------------------------- types ---------------------------------- */

export interface PublicStats {
	pageviews: number;
	visitors: number;
	sessions: number;
	bounceRate: number;
	avgDuration: number;
	revenue: number;
	conversions: number;
}

export interface SourceRow {
	source: string;
	visitors: number;
	percentage: number;
}

export interface DeviceRow {
	device: string;
	visitors: number;
	percentage: number;
}

export interface ChannelRow {
	channel: string;
	visitors: number;
	pageviews: number;
	revenue: number;
	percentage: number;
}

export interface PublicDashboard {
	/** ISO code for every revenue figure; USD when absent. */
	currency?: string;
	stats: PublicStats;
	timeseries: { date: string; pageviews: number; visitors: number }[];
	topPages: { path: string; pageviews: number; visitors: number }[];
	sources: SourceRow[];
	devices: DeviceRow[];
	os: DeviceRow[];
	browsers: DeviceRow[];
	revenueBySource: { source: string; revenue: number; conversions: number }[];
	revenueByCountry: { country: string; revenue: number; conversions: number }[];
	revenueTimeseries: { date: string; revenue: number; conversions: number }[];
	channels: ChannelRow[];
}

export interface PublicPayload {
	site: { name: string | null; domain: string | null };
	dashboard: PublicDashboard;
	currency?: string;
}
export interface LiveState {
	online: number | null;
	updatedAt: string | null;
}

/* ------------------------------ panel helpers ----------------------------- */

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
		return <p className="text-muted-foreground py-6 text-center text-xs">Loading…</p>;
	}
	if (!hasData) {
		return <p className="text-muted-foreground py-6 text-center text-xs">{emptyText}</p>;
	}
	return <>{children}</>;
};

const LivePill = ({ online, updatedAt }: LiveState) => (
	<span className="flex items-center gap-2 rounded-full border border-(--up)/20 bg-(--up)/10 px-2.5 py-1 text-[11px] text-(--up)">
		<span className="relative flex size-2" aria-hidden>
			<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--up) opacity-75" />
			<span className="relative inline-flex size-2 rounded-full bg-(--up)" />
		</span>
		<span className="font-mono tabular-nums">{online === null ? "…" : fmtC(online)}</span>
		online
		{updatedAt ? (
			<span className="text-muted-foreground tabular-nums">
				· upd{" "}
				{new Date(updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
			</span>
		) : null}
	</span>
);

const deviceGlyph = (device: string): ReactNode => {
	if (device === "mobile") {
		return <Smartphone className="text-muted-foreground size-4 shrink-0" aria-hidden />;
	}
	if (device === "tablet") {
		return <Tablet className="text-muted-foreground size-4 shrink-0" aria-hidden />;
	}
	return <Monitor className="text-muted-foreground size-4 shrink-0" aria-hidden />;
};

const MONEY_GLYPH = (
	<span
		className="grid size-4 shrink-0 place-items-center rounded-[5px] bg-(--money)/15 font-mono text-[9px] font-bold text-(--money)"
		aria-hidden
	>
		$
	</span>
);

interface LabelledRow {
	label: string;
	value: number;
	glyph?: ReactNode;
}

const RowsBody = ({
	rows,
	loading,
	isMoney,
	currency,
}: {
	rows: LabelledRow[];
	loading: boolean;
	isMoney?: boolean;
	currency?: string;
}) => {
	const total = rows.reduce((acc, r) => acc + r.value, 0);
	return (
		<PanelBody loading={loading} hasData={rows.length > 0} emptyText="No data yet.">
			<div className="grid max-h-[420px] gap-1 overflow-y-auto">
				{rows.map((r) => (
					<CountBarRow
						key={r.label}
						glyph={r.glyph ?? (isMoney ? MONEY_GLYPH : undefined)}
						label={r.label}
						value={isMoney ? money(r.value, currency) : fmtC(r.value)}
						share={total > 0 ? (r.value / total) * 100 : 0}
						fill={isMoney ? "var(--money)" : undefined}
					/>
				))}
			</div>
		</PanelBody>
	);
};

/* ------------------------------- sub panels ------------------------------- */

function SourcesPanel({ dash, loading }: { dash: PublicDashboard | undefined; loading: boolean }) {
	const [tab, setTab] = useState<"referrer" | "channel">("referrer");
	const rows: LabelledRow[] = useMemo(
		() =>
			tab === "channel"
				? (dash?.channels ?? []).map((c) => ({ label: c.channel, value: c.visitors }))
				: (dash?.sources ?? []).map((s) => ({
						label: s.source,
						value: s.visitors,
						glyph: <Globe className="text-muted-foreground size-4 shrink-0" aria-hidden />,
					})),
		[dash, tab],
	);
	return (
		<Panel
			title="Sources"
			tabs={
				<PanelTabs
					value={tab}
					onChange={setTab}
					tabs={[
						{ key: "referrer", label: "Referrer" },
						{ key: "channel", label: "Channel" },
					]}
				/>
			}
		>
			<RowsBody rows={rows} loading={loading} />
		</Panel>
	);
}

function PlatformPanel({ dash, loading }: { dash: PublicDashboard | undefined; loading: boolean }) {
	const [tab, setTab] = useState<"device" | "os" | "browser">("device");
	const rows: LabelledRow[] = useMemo(() => {
		const src =
			tab === "os"
				? (dash?.os ?? [])
				: tab === "browser"
					? (dash?.browsers ?? [])
					: (dash?.devices ?? []);
		return src.map((d) => ({
			label: d.device,
			value: d.visitors,
			glyph: tab === "device" ? deviceGlyph(d.device) : undefined,
		}));
	}, [dash, tab]);
	return (
		<Panel
			title="Platform"
			tabs={
				<PanelTabs
					value={tab}
					onChange={setTab}
					tabs={[
						{ key: "device", label: "Device" },
						{ key: "os", label: "OS" },
						{ key: "browser", label: "Browser" },
					]}
				/>
			}
		>
			<RowsBody rows={rows} loading={loading} />
		</Panel>
	);
}

function RevenuePanel({ dash, loading }: { dash: PublicDashboard | undefined; loading: boolean }) {
	const [tab, setTab] = useState<"source" | "country">("source");
	const rows: LabelledRow[] = useMemo(
		() =>
			tab === "country"
				? (dash?.revenueByCountry ?? []).map((r) => ({ label: r.country, value: r.revenue }))
				: (dash?.revenueBySource ?? []).map((r) => ({ label: r.source, value: r.revenue })),
		[dash, tab],
	);
	return (
		<Panel
			title="Revenue"
			tabs={
				<PanelTabs
					value={tab}
					onChange={setTab}
					tabs={[
						{ key: "source", label: "Source" },
						{ key: "country", label: "Country" },
					]}
				/>
			}
		>
			<RowsBody rows={rows} loading={loading} isMoney currency={dash?.currency} />
		</Panel>
	);
}

/* ---------------------------------- view ---------------------------------- */

export interface PublicDashboardViewProps {
	site: PublicPayload["site"] | undefined;
	dash: PublicDashboard | undefined;
	loading: boolean;
	/** Message for the red banner; null when the data loaded. */
	error: string | null;
	range: RangeKey;
	onRangeChange: (range: RangeKey) => void;
	live: LiveState;
	embed: boolean;
}

export function PublicDashboardView({
	site,
	dash,
	loading,
	error,
	range,
	onRangeChange,
	live,
	embed,
}: PublicDashboardViewProps) {
	const hourly = range === "24h";
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
		if (!dash || dash.revenueTimeseries.length === 0) return undefined;
		// "YYYY-MM-DD" for day buckets, "YYYY-MM-DDTHH" for hourly ones.
		const keyLen = hourly ? 13 : 10;
		const byDate = new Map(dash.revenueTimeseries.map((r) => [r.date.slice(0, keyLen), r.revenue]));
		const aligned = points.map((p) => byDate.get(p.date?.slice(0, keyLen) ?? "") ?? 0);
		return aligned.some((v) => v > 0) ? aligned : undefined;
	}, [dash, points, hourly]);

	const stats = dash?.stats;
	const topPages = dash?.topPages ?? [];
	const pad = embed ? "p-2" : "px-3 pt-3 pb-6 md:px-4";
	const title = site?.name ?? site?.domain ?? "Public dashboard";

	return (
		<div className="bg-background text-foreground min-h-svh">
			<main className={`mx-auto max-w-7xl ${pad}`}>
				<header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
						<LivePill {...live} />
					</div>
					<PanelTabs
						value={range}
						onChange={onRangeChange}
						tabs={RANGES.map((r) => ({ key: r.key, label: r.label }))}
					/>
				</header>

				{error ? (
					<p
						className="bg-(--down)/10 text-(--down) mb-2.5 rounded-xl px-3 py-2 text-xs"
						role="alert"
					>
						Couldn't load the dashboard ({error}).
					</p>
				) : null}

				<div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
					<StatTile label="Online now" value={live.online === null ? "…" : fmtC(live.online)} />
					<StatTile label="Visitors" value={stats ? fmt(stats.visitors) : "…"} />
					<StatTile label="Pageviews" value={stats ? fmt(stats.pageviews) : "…"} />
					<StatTile label="Sessions" value={stats ? fmt(stats.sessions) : "…"} />
					<StatTile label="Bounce rate" value={stats ? `${stats.bounceRate.toFixed(1)}%` : "…"} />
					<StatTile label="Revenue" value={stats ? money(stats.revenue, dash?.currency) : "…"} />
				</div>

				<section className="bg-card ring-foreground/10 mb-2.5 rounded-2xl p-3 ring-1">
					<div className="text-muted-foreground mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
						<div className="flex items-center gap-4">
							<span className="flex items-center gap-1.5">
								<span className="h-0.5 w-4 rounded-full bg-(--chart)" aria-hidden />
								Visitors
							</span>
							{revenueSeries ? (
								<span className="flex items-center gap-1.5">
									<span className="h-2.5 w-2.5 rounded-[3px] bg-(--money)" aria-hidden />
									Revenue
								</span>
							) : null}
						</div>
						<span className="font-mono tabular-nums">
							{points[0]?.full}
							{points.length > 1 ? ` – ${points.at(-1)?.full}` : ""}
						</span>
					</div>
					<PanelBody
						loading={loading}
						hasData={points.length > 0}
						emptyText="No traffic in this range."
					>
						<TrafficChart points={points} revenue={revenueSeries} currency={dash?.currency} />
					</PanelBody>
				</section>

				<div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
					<Panel title="Top pages">
						<RowsBody
							loading={loading}
							rows={topPages.map((p) => ({
								label: p.path,
								value: p.pageviews,
								glyph: <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />,
							}))}
						/>
					</Panel>
					<SourcesPanel dash={dash} loading={loading} />
					<PlatformPanel dash={dash} loading={loading} />
					<RevenuePanel dash={dash} loading={loading} />
				</div>
			</main>
			{!embed && <PublicFooter />}
		</div>
	);
}

/* Viewers of a shared dashboard are prospects: credit RevKlik and offer the
   same dashboard. UTM tags (not ?ref=, which is the affiliate code) mark
   the source. */
const PUBLIC_UTM = "utm_source=public-dashboard&utm_medium=referral";

function PublicFooter() {
	const t = useT();
	return (
		<footer className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-4 text-xs">
			<a
				href={`https://revklik.com/?${PUBLIC_UTM}`}
				target="_blank"
				rel="noopener noreferrer"
				className="hover:text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center rounded-sm underline-offset-2 outline-offset-2 hover:underline focus-visible:outline-2"
			>
				Powered by RevKlik
			</a>
			<span aria-hidden>·</span>
			<a
				href={`https://app.revklik.com/register?${PUBLIC_UTM}`}
				target="_blank"
				rel="noopener noreferrer"
				className="text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-2 outline-offset-2 focus-visible:outline-2"
			>
				{t("public.makeYours")}
			</a>
		</footer>
	);
}

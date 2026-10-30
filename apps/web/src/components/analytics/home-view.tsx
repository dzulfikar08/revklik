import { Button, buttonVariants } from "@revklik/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Code2, Download, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { CompareKey, LegacyStats, SiteDashboard, StatsChange } from "@/lib/legacy/api";
import type { LegacyAnnotation } from "@/lib/legacy/analytics-settings";

import { AnnotationsControl } from "./annotations";
import { deltaBadge, duration, fmt, fmtDecimal, money, RANGES } from "./data";
import type { Point, RangeKey } from "./data";
import type { NextStep } from "./next-steps";
import { PanelState } from "./panel-state";
import { TrafficChart } from "./ui";
import type { WidenAction } from "./breakdown-panels";

/* ------------------------------ toolbar: title + range ---------------------- */

const RANGE_LABEL: Record<RangeKey, MessageKey> = {
	"24h": "range.24h",
	"30d": "range.30d",
	"7d": "range.7d",
	"90d": "range.90d",
};

const RangePills = ({
	rangeKey,
	onRange,
}: {
	rangeKey: RangeKey;
	onRange: (r: RangeKey) => void;
}) => {
	const t = useT();
	return (
		<div
			role="group"
			aria-label={t("overview.rangeLabel")}
			className="bg-muted/70 flex flex-1 rounded-full p-1 sm:flex-none"
		>
			{RANGES.map((r) => (
				<button
					key={r.key}
					type="button"
					aria-pressed={rangeKey === r.key}
					aria-label={t(RANGE_LABEL[r.key])}
					onClick={() => onRange(r.key)}
					className={`focus-visible:outline-ring pointer-coarse:min-h-11 min-h-8 flex-1 rounded-full px-3 text-[13px] font-medium tabular-nums outline-offset-2 transition-colors duration-150 focus-visible:outline-2 sm:flex-none ${
						rangeKey === r.key
							? "bg-card text-foreground ring-foreground/10 shadow-xs ring-1"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{r.label}
				</button>
			))}
		</div>
	);
};

export const HomeToolbar = ({
	domain,
	period,
	rangeKey,
	onRange,
	onExport,
	exporting,
}: {
	domain: string | undefined;
	/** "23 Okt – 30 Okt", or undefined while the first response is loading. */
	period: string | undefined;
	rangeKey: RangeKey;
	onRange: (r: RangeKey) => void;
	onExport: () => void;
	exporting: boolean;
}) => {
	const t = useT();
	return (
		<div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-3">
			<div className="min-w-0 flex-1">
				<h1 className="h-7 truncate text-xl leading-7 font-semibold tracking-tight">
					{domain ?? (
						<span className="bg-muted inline-block h-5 w-40 animate-pulse rounded-md align-middle" />
					)}
				</h1>
				<p className="text-muted-foreground h-5 text-[13px] leading-5 tabular-nums">
					{period ? `${period} · ${t("home.vsPrevious")}` : null}
				</p>
			</div>
			<div className="flex w-full items-center gap-2 sm:w-auto">
				<RangePills rangeKey={rangeKey} onRange={onRange} />
				<Button
					variant="outline"
					aria-label={t("home.export")}
					title={t("home.export")}
					disabled={exporting || !domain}
					onClick={onExport}
					className="pointer-coarse:size-11 size-9 shrink-0 rounded-full p-0"
				>
					<Download className={`size-4 ${exporting ? "animate-pulse" : ""}`} aria-hidden />
				</Button>
			</div>
		</div>
	);
};

/* ------------------------------------ hero ---------------------------------- */

const DeltaChip = ({
	change,
	lowerIsBetter,
}: {
	change: StatsChange | undefined;
	lowerIsBetter?: boolean;
}) => {
	const t = useT();
	const badge = deltaBadge(change, lowerIsBetter);
	if (!badge) {
		return null;
	}
	const good = badge.tone === "good";
	return (
		<span
			className={`inline-flex items-center rounded-md px-1.5 text-[13px] font-medium whitespace-nowrap tabular-nums ${
				good ? "bg-(--up)/12 text-(--up)" : "bg-(--down)/12 text-(--down)"
			}`}
		>
			{badge.label}
			<span className="sr-only"> {t("dash.vsPrevious")}</span>
		</span>
	);
};

const HeroCard = ({
	label,
	flag,
	value,
	loading,
	change,
	sub,
	primary = false,
	money: isMoney = false,
	className = "",
}: {
	label: string;
	/** Small marker next to the label ("est."). */
	flag?: { text: string; title: string };
	value: string | undefined;
	loading: boolean;
	change?: StatsChange;
	sub?: ReactNode;
	primary?: boolean;
	money?: boolean;
	className?: string;
}) => {
	const t = useT();
	return (
		<div
			className={`bg-card ring-foreground/10 min-w-0 rounded-2xl p-3 ring-1 sm:p-4 ${
				primary ? "ring-(--money)/30" : ""
			} ${className}`}
		>
			<p className="text-muted-foreground flex h-5 items-center gap-1.5 text-[13px] leading-5">
				<span className="truncate">{label}</span>
				{flag ? (
					<span
						title={flag.title}
						className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 text-xs font-medium"
					>
						{flag.text}
					</span>
				) : null}
			</p>
			<p
				className={`mt-0.5 h-9 text-[26px] leading-9 font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-[28px] ${
					isMoney ? "text-(--money)" : ""
				}`}
			>
				{loading ? (
					<>
						<span
							className="bg-muted inline-block h-6 w-32 animate-pulse rounded-md align-middle"
							aria-hidden
						/>
						<span className="sr-only">{t("dash.loadingLabel", { label })}</span>
					</>
				) : (
					(value ?? "–")
				)}
			</p>
			<p className="mt-1 flex h-6 items-center gap-2 text-[13px] leading-6">
				{loading ? null : (
					<>
						<DeltaChip change={change} />
						{sub}
					</>
				)}
			</p>
		</div>
	);
};

const noPrevious = (change: StatsChange | undefined): boolean => !deltaBadge(change);

export const Hero = ({ dash, loading }: { dash: SiteDashboard | undefined; loading: boolean }) => {
	const t = useT();
	const stats = dash?.stats;
	const currency = dash?.currency;
	// A range with no traffic and no sales has nothing honest to compare.
	const quiet = stats !== undefined && stats.pageviews === 0 && stats.revenue === 0;
	const cmp = (key: CompareKey): StatsChange | undefined =>
		quiet ? undefined : dash?.compare?.[key];
	const hasNet = stats ? stats.netRevenue !== undefined : true;
	const conversion =
		stats && stats.visitors > 0
			? `${fmtDecimal((stats.conversions / stats.visitors) * 100, 1)}%`
			: undefined;
	const prevHint = (change: StatsChange | undefined): ReactNode => {
		if (!stats) {
			return null;
		}
		return noPrevious(change) ? (
			<span className="text-muted-foreground truncate">{t("home.noPrevious")}</span>
		) : (
			<span className="text-muted-foreground truncate">{t("home.vsPreviousShort")}</span>
		);
	};

	return (
		<div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
			{hasNet ? (
				<HeroCard
					primary
					money
					className="col-span-2 lg:col-span-1"
					label={t("home.net")}
					flag={
						stats?.netEstimated ? { text: t("home.est"), title: t("home.estTitle") } : undefined
					}
					loading={loading}
					value={stats?.netRevenue === undefined ? undefined : money(stats.netRevenue, currency)}
					change={cmp("netRevenue")}
					sub={prevHint(cmp("netRevenue"))}
				/>
			) : null}
			<HeroCard
				money
				primary={!hasNet}
				className="col-span-2 lg:col-span-1"
				label={t("home.gross")}
				loading={loading}
				value={stats ? money(stats.revenue, currency) : undefined}
				change={cmp("revenue")}
				sub={prevHint(cmp("revenue"))}
			/>
			<HeroCard
				label={t("home.sales")}
				loading={loading}
				value={stats ? fmt(stats.conversions) : undefined}
				change={cmp("conversions")}
				sub={prevHint(cmp("conversions"))}
			/>
			<HeroCard
				label={t("home.conversion")}
				loading={loading}
				value={conversion}
				sub={
					stats && stats.visitors > 0 ? (
						<span className="text-muted-foreground truncate">
							{t("home.conversionNote", {
								sales: fmt(stats.conversions),
								visitors: fmt(stats.visitors),
							})}
						</span>
					) : null
				}
			/>
		</div>
	);
};

const SecondaryStat = ({
	label,
	value,
	change,
	lowerIsBetter,
	loading,
}: {
	label: string;
	value: string | undefined;
	change?: StatsChange;
	lowerIsBetter?: boolean;
	loading: boolean;
}) => (
	<div className="min-w-0">
		<dt className="text-muted-foreground h-5 text-[13px] leading-5">{label}</dt>
		<dd className="flex h-6 items-center gap-1.5 text-[15px] leading-6 font-semibold tabular-nums">
			{loading ? (
				<span className="bg-muted inline-block h-4 w-14 animate-pulse rounded" aria-hidden />
			) : (
				<>
					<span>{value ?? "–"}</span>
					<DeltaChip change={change} lowerIsBetter={lowerIsBetter} />
				</>
			)}
		</dd>
	</div>
);

export const SecondaryStats = ({
	stats,
	compare,
	loading,
}: {
	stats: LegacyStats | undefined;
	compare: SiteDashboard["compare"];
	loading: boolean;
}) => {
	const t = useT();
	// Bounce and duration are session aggregates: with no sessions in range
	// they would read as a real "0.0%" / "0m 00s", so say there is no data.
	const noSessions = stats !== undefined && stats.sessions === 0;
	const quiet = stats !== undefined && stats.pageviews === 0 && stats.revenue === 0;
	const cmp = (key: CompareKey): StatsChange | undefined => (quiet ? undefined : compare?.[key]);
	return (
		<dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 px-1 sm:grid-cols-4">
			<SecondaryStat
				label={t("kpi.visitors")}
				loading={loading}
				value={stats ? fmt(stats.visitors) : undefined}
				change={cmp("visitors")}
			/>
			<SecondaryStat
				label={t("kpi.pageviews")}
				loading={loading}
				value={stats ? fmt(stats.pageviews) : undefined}
				change={cmp("pageviews")}
			/>
			<SecondaryStat
				label={t("kpi.bounce")}
				loading={loading}
				value={
					stats
						? noSessions
							? t("dash.noSessions")
							: `${fmtDecimal(stats.bounceRate, 1)}%`
						: undefined
				}
				change={noSessions ? undefined : cmp("bounceRate")}
				lowerIsBetter
			/>
			<SecondaryStat
				label={t("kpi.duration")}
				loading={loading}
				value={
					stats ? (noSessions ? t("dash.noSessions") : duration(stats.avgDuration)) : undefined
				}
				change={noSessions ? undefined : cmp("avgDuration")}
			/>
		</dl>
	);
};

/* ----------------------------------- chart ---------------------------------- */

const CHART_BOX = "h-[14.25rem] md:h-[16.25rem]";

export const ChartCard = ({
	siteId,
	points,
	revenue,
	currency,
	annotations,
	onAnnotations,
	loading,
	error,
	onRetry,
	retrying,
	noTrafficYet,
	domain,
	onInstall,
	widen,
}: {
	siteId: string;
	points: Point[];
	revenue: number[] | undefined;
	currency: string | undefined;
	annotations: LegacyAnnotation[];
	onAnnotations: (a: LegacyAnnotation[]) => void;
	loading: boolean;
	error: unknown;
	onRetry: () => void;
	retrying: boolean;
	noTrafficYet: boolean;
	domain: string | undefined;
	onInstall: () => void;
	widen?: WidenAction;
}) => {
	const t = useT();
	return (
		<section className="bg-card ring-foreground/10 mb-3 rounded-2xl p-4 ring-1">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 className="text-sm font-semibold">
						{t(revenue || loading ? "home.chart.title" : "home.chart.titleVisitors")}
					</h2>
					<div className="text-muted-foreground mt-1 flex items-center gap-4 text-[13px]">
						{revenue ? (
							<span className="flex items-center gap-1.5">
								<span className="bg-(--money) size-2.5 rounded-[3px]" aria-hidden />
								{t("chart.revenue")}
							</span>
						) : null}
						<span className="flex items-center gap-1.5">
							<span className="h-0.5 w-4 rounded-full bg-(--chart)" aria-hidden />
							{t("chart.visitors")}
						</span>
					</div>
				</div>
				<span className="flex flex-wrap items-center gap-2">
					<AnnotationsControl siteId={siteId} onAnnotations={onAnnotations} />
				</span>
			</div>
			{noTrafficYet && domain ? (
				<div
					className={`${CHART_BOX} flex flex-col items-center justify-center gap-2 px-4 text-center`}
				>
					<p className="text-sm font-semibold">{t("install.emptyTitle")}</p>
					<p className="text-muted-foreground max-w-sm text-[13px]">
						{t("install.emptyDesc", { domain })}
					</p>
					<Button className="pointer-coarse:h-11 mt-2 h-9" onClick={onInstall}>
						<Code2 className="size-3.5" aria-hidden />
						{t("install.cta")}
					</Button>
				</div>
			) : (
				<PanelState
					loading={loading}
					error={error}
					onRetry={onRetry}
					retrying={retrying}
					hasData={points.length > 0}
					emptyText={t("home.chart.empty")}
					emptyAction={widen}
					boxClass={`${CHART_BOX} flex flex-col justify-center`}
					skeleton={
						<div className={CHART_BOX} role="status">
							<span className="sr-only">{t("dash.loadingChart")}</span>
							<div className="bg-muted/40 h-52 animate-pulse rounded-lg md:h-60" aria-hidden />
						</div>
					}
				>
					<TrafficChart
						points={points}
						annotations={annotations}
						revenue={revenue}
						currency={currency}
					/>
				</PanelState>
			)}
		</section>
	);
};

/* -------------------------------- what next --------------------------------- */

export type NextAction =
	| { kind: "install" }
	| { kind: "connect" }
	| { kind: "filter"; dimension: string; value: string };

const stepText = (step: NextStep, t: ReturnType<typeof useT>): string => {
	switch (step.id) {
		case "install":
			return t("next.install");
		case "connect":
			return t("next.connect");
		case "bestSource":
			return t("next.bestSource", { share: step.share, source: step.source });
		case "bestPage":
			return t("next.bestPage", { path: step.path });
		case "revenueDown":
			return t("next.revenueDown", { pct: step.pct });
		default:
			return t("next.fees");
	}
};

const stepActionLabel = (step: NextStep): MessageKey | null => {
	switch (step.id) {
		case "install":
			return "install.cta";
		case "connect":
			return "next.connectCta";
		case "bestSource":
			return "next.onlyThisSource";
		case "bestPage":
			return "next.onlyThisPage";
		default:
			return null;
	}
};

export const NextStepsCard = ({
	steps,
	onAction,
}: {
	steps: NextStep[];
	onAction: (action: NextAction) => void;
}) => {
	const t = useT();
	if (steps.length === 0) {
		return null;
	}
	const run = (step: NextStep): void => {
		if (step.id === "install") {
			onAction({ kind: "install" });
		} else if (step.id === "connect") {
			onAction({ kind: "connect" });
		} else if (step.id === "bestSource") {
			onAction({ dimension: "source", kind: "filter", value: step.source });
		} else if (step.id === "bestPage") {
			onAction({ dimension: "path", kind: "filter", value: step.path });
		}
	};
	return (
		<section className="bg-card ring-foreground/10 mb-3 rounded-2xl p-4 ring-1">
			<h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
				<Lightbulb className="size-4 text-(--money)" aria-hidden />
				{t("next.title")}
			</h2>
			<ul className="divide-border divide-y">
				{steps.map((step) => {
					const actionKey = stepActionLabel(step);
					return (
						<li
							key={step.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0"
						>
							<p className="min-w-0 flex-1 basis-60 text-[13px] leading-5 text-pretty">
								{stepText(step, t)}
							</p>
							{actionKey ? (
								<Button
									variant="outline"
									onClick={() => run(step)}
									className="pointer-coarse:h-11 h-9 px-3 text-[13px]"
								>
									{t(actionKey)}
									<ArrowRight className="size-3.5" aria-hidden />
								</Button>
							) : null}
							{step.id === "feesEstimated" ? (
								<Link
									to="/analytics/portfolio"
									className={buttonVariants({
										className: "pointer-coarse:h-11 h-9 px-3 text-[13px]",
										variant: "outline",
									})}
								>
									{t("next.feesCta")}
									<ArrowRight className="size-3.5" aria-hidden />
								</Link>
							) : null}
						</li>
					);
				})}
			</ul>
		</section>
	);
};

/* -------------------------------- section switch ---------------------------- */

export type HomeSection = "traffic" | "behavior";

export const SectionSwitch = ({
	value,
	onChange,
}: {
	value: HomeSection;
	onChange: (section: HomeSection) => void;
}) => {
	const t = useT();
	const options: { key: HomeSection; label: string }[] = [
		{ key: "traffic", label: t("home.section.traffic") },
		{ key: "behavior", label: t("home.section.behavior") },
	];
	return (
		<div
			role="group"
			aria-label={t("home.section.label")}
			className="bg-muted/70 mb-3 inline-flex rounded-full p-1"
		>
			{options.map((o) => (
				<button
					key={o.key}
					type="button"
					aria-pressed={value === o.key}
					onClick={() => onChange(o.key)}
					className={`focus-visible:outline-ring pointer-coarse:min-h-11 min-h-9 rounded-full px-5 text-sm font-medium outline-offset-2 transition-colors duration-150 focus-visible:outline-2 ${
						value === o.key
							? "bg-card text-foreground ring-foreground/10 shadow-xs ring-1"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
};

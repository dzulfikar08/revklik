import createGlobe from "cobe";
import {
	ArrowDownRight,
	ArrowDownUp,
	ArrowUpRight,
	Check,
	Monitor,
	Smartphone,
	Tablet,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode, TouchEvent } from "react";

import { useT } from "@/lib/i18n";

import { fmt, money, niceMax } from "./data";
import type { Point } from "./data";

interface PlatformRow {
	device?: "mobile" | "tablet" | "desktop";
	shape?: "square" | "circle";
	bg?: string;
	hole?: boolean;
}

/* -------------------------------- stat tile -------------------------------- */

export const StatTile = ({
	label,
	value,
	delta,
	tone = "good",
	className = "",
	note,
}: {
	label: string;
	/** Undefined while loading: a skeleton holds the value's line height. */
	value: string | undefined;
	/** Omitted when there is no previous period to compare against. */
	delta?: string;
	tone?: "good" | "bad";
	className?: string;
	/** Replaces a value that would be misleading (e.g. no sessions to average). */
	note?: string;
}) => {
	const t = useT();
	const Arrow = tone === "good" ? ArrowUpRight : ArrowDownRight;
	return (
		<div
			className={`bg-card ring-foreground/10 min-w-0 rounded-2xl px-3 py-2.5 ring-1 ${className}`}
		>
			<p className="text-muted-foreground text-[13px]">{label}</p>
			<div className="mt-0.5 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
				{note && value !== undefined ? (
					<span className="text-muted-foreground text-[13px] leading-7">{note}</span>
				) : value === undefined ? (
					<>
						<span className="bg-muted h-5 w-20 animate-pulse rounded-md" aria-hidden />
						<span className="sr-only">{t("dash.loadingLabel", { label })}</span>
					</>
				) : (
					<span className="text-[22px] leading-7 font-semibold tracking-tight whitespace-nowrap tabular-nums">
						{value}
					</span>
				)}
				{value !== undefined && delta != null ? (
					<span
						className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums ${
							tone === "good" ? "bg-(--up)/10 text-(--up)" : "bg-(--down)/10 text-(--down)"
						}`}
					>
						<Arrow className="size-3" aria-hidden />
						{delta}
						<span className="sr-only"> {t("dash.vsPrevious")}</span>
					</span>
				) : null}
			</div>
		</div>
	);
};

/* ------------------------------ panel wrappers ----------------------------- */

export const PanelTabs = <T extends string>({
	tabs,
	value,
	onChange,
	label,
}: {
	tabs: readonly { readonly key: T; readonly label: string }[];
	value: T;
	onChange: (key: T) => void;
	/** Names the switch for assistive tech ("Revenue by"). */
	label?: string;
}) => (
	<div role="group" aria-label={label} className="bg-muted/70 flex flex-wrap rounded-lg p-0.5">
		{tabs.map((t) => (
			<button
				key={t.key}
				type="button"
				aria-pressed={value === t.key}
				onClick={() => onChange(t.key)}
				className={`focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:px-3.5 min-h-8 rounded-md px-2.5 text-[13px] font-medium outline-offset-1 focus-visible:outline-2 ${
					value === t.key
						? "bg-card text-foreground ring-foreground/10 shadow-xs ring-1"
						: "text-muted-foreground hover:text-foreground"
				}`}
			>
				{t.label}
			</button>
		))}
	</div>
);

export const Panel = ({
	title,
	tabs,
	hint,
	children,
}: {
	title?: string;
	tabs?: ReactNode;
	hint?: ReactNode;
	children: ReactNode;
}) => (
	<section className="bg-card ring-foreground/10 rounded-2xl p-3 ring-1">
		<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
			{tabs ?? <h2 className="text-sm font-semibold">{title}</h2>}
			{hint ? <span className="text-muted-foreground text-[13px]">{hint}</span> : null}
		</div>
		{children}
	</section>
);

const PILL_TONES = {
	down: "bg-(--down)/10 text-(--down) ring-(--down)/20",
	muted: "bg-muted text-muted-foreground ring-foreground/10",
	up: "bg-(--up)/10 text-(--up) ring-(--up)/20",
} as const;

/** Small status label; `on` picks green or grey unless `tone` names one. */
export const StatusPill = ({
	on,
	label,
	tone,
}: {
	on: boolean;
	label: string;
	tone?: keyof typeof PILL_TONES;
}) => (
	<span
		className={`font-mono text-[9px] font-semibold tracking-wider uppercase ring-1 rounded-full px-2 py-1 ${
			PILL_TONES[tone ?? (on ? "up" : "muted")]
		}`}
	>
		{label}
	</span>
);

/**
 * Loading placeholder shaped like the bar rows it stands in for, so a panel
 * keeps its height when data lands instead of jumping from one text line.
 */
export const SkeletonRows = ({ rows = 6, label }: { rows?: number; label?: string }) => {
	const t = useT();
	return (
		<div className="grid gap-1" role="status">
			<span className="sr-only">{label ?? t("dash.loading")}</span>
			{Array.from({ length: rows }, (_, i) => (
				<div
					key={i}
					aria-hidden
					className="bg-muted/40 pointer-coarse:h-11 flex h-9 items-center justify-between gap-4 rounded-lg px-2.5"
				>
					<span
						className="bg-muted h-3 animate-pulse rounded"
						style={{ width: `${Math.max(28, 72 - i * 9)}%` }}
					/>
					<span className="bg-muted h-3 w-8 animate-pulse rounded" />
				</div>
			))}
		</div>
	);
};

/**
 * Renders a translated sentence whose `{name}` placeholders are code
 * snippets (attribute names, globals): translators keep the sentence whole
 * while the code stays verbatim and unbroken.
 */
const PLACEHOLDER_SPLIT = /(\{\w+\})/u;
const PLACEHOLDER_NAME = /^\{(\w+)\}$/u;

export const CodeSentence = ({
	template,
	codes,
}: {
	template: string;
	codes: Record<string, string>;
}) => (
	<>
		{template.split(PLACEHOLDER_SPLIT).map((part, i) => {
			const name = PLACEHOLDER_NAME.exec(part)?.[1];
			const code = name ? codes[name] : undefined;
			return code ? (
				<code key={`${part}-${i}`} className="text-foreground/80 whitespace-nowrap">
					{code}
				</code>
			) : (
				part
			);
		})}
	</>
);

export const SortHint = ({
	label,
	dir,
	onToggle,
}: {
	label: string;
	dir?: "desc" | "asc";
	onToggle: () => void;
}) => {
	const t = useT();
	let aria = t("sort.by", { label });
	if (dir) {
		aria = t(dir === "desc" ? "sort.desc" : "sort.asc", { label });
	}
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={aria}
			className="text-muted-foreground hover:text-foreground focus-visible:outline-ring pointer-coarse:min-h-11 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[13px] outline-offset-2 focus-visible:outline-2"
		>
			{label}
			<ArrowDownUp className={`size-3.5 ${dir === "asc" ? "rotate-180" : ""}`} aria-hidden />
		</button>
	);
};

/* -------------------------------- bar rows --------------------------------- */

/**
 * Ranked row with a proportional fill. The fill is a low-opacity wash clipped
 * by the row's own radius (no radius of its own, so a short value reads as a
 * bar rather than a pill under the icon) and ends in a 2px solid edge that
 * marks the value. Text sits on the wash, so contrast matches a plain row.
 */
export const CountBarRow = ({
	glyph,
	label,
	value,
	share,
	fill = "var(--chart)",
	note,
	onSelect,
	selected = false,
	selectLabel,
}: {
	glyph?: ReactNode;
	label: string;
	value: string;
	share: number;
	fill?: string;
	/** Quiet secondary figure next to the value ("3 sales"). */
	note?: string;
	/** Makes the row a filter toggle; omit for rows the API cannot filter on. */
	onSelect?: () => void;
	selected?: boolean;
	/** Accessible name for the toggle ("Filter by google"). */
	selectLabel?: string;
}) => {
	const pct = Number.isFinite(share) ? Math.min(100, Math.max(share, 0)) : 0;
	const rowClass = `relative block h-9 w-full overflow-hidden rounded-lg text-start transition-colors ${
		selected ? "bg-muted ring-foreground/25 ring-1" : "bg-muted/40 hover:bg-muted/60"
	} pointer-coarse:h-11`;
	const body = (
		<>
			{pct > 0 ? (
				<span
					aria-hidden
					className="absolute inset-y-0 left-0 border-r-2"
					style={{
						backgroundColor: `color-mix(in oklab, ${fill} ${selected ? 30 : 22}%, transparent)`,
						borderColor: `color-mix(in oklab, ${fill} 60%, transparent)`,
						minWidth: 3,
						width: `${pct}%`,
					}}
				/>
			) : null}
			<span className="relative flex h-full items-center gap-2 px-2.5 text-[13px]">
				{glyph}
				<span className="min-w-0 flex-1 truncate font-medium">{label}</span>
				{note ? (
					<span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">
						{note}
					</span>
				) : null}
				<span className="text-foreground/90 shrink-0 text-[13px] font-medium tabular-nums">
					{value}
				</span>
				{onSelect ? (
					<Check
						className={`size-3.5 shrink-0 ${selected ? "text-foreground" : "text-transparent"}`}
						aria-hidden
					/>
				) : null}
			</span>
		</>
	);
	if (!onSelect) {
		return <div className={rowClass}>{body}</div>;
	}
	return (
		<button
			type="button"
			aria-pressed={selected}
			aria-label={selectLabel}
			onClick={onSelect}
			className={`${rowClass} focus-visible:outline-ring cursor-pointer outline-offset-2 focus-visible:outline-2`}
		>
			{body}
		</button>
	);
};

const deviceIconEl = (device: PlatformRow["device"]) => {
	if (device === "mobile") {
		return <Smartphone className="text-muted-foreground size-4 shrink-0" aria-hidden />;
	}
	if (device === "tablet") {
		return <Tablet className="text-muted-foreground size-4 shrink-0" aria-hidden />;
	}
	return <Monitor className="text-muted-foreground size-4 shrink-0" aria-hidden />;
};

export const PlatformGlyph = ({ row }: { row: PlatformRow }) => {
	if (row.device) {
		return deviceIconEl(row.device);
	}
	return (
		<span
			className={`grid size-4 shrink-0 place-items-center ${
				row.shape === "square" ? "rounded-[5px]" : "rounded-full"
			}`}
			style={{ background: row.bg }}
			aria-hidden
		>
			{row.hole ? <span className="bg-card size-1.5 rounded-full" /> : null}
		</span>
	);
};

/* ------------------------------- traffic chart ------------------------------ */

const W = 1000;
const H = 300;

const round1 = (n: number): number => Math.round(n * 10) / 10;

const smoothPath = (pts: readonly (readonly [number, number])[]): string => {
	if (pts.length < 2) {
		return "";
	}
	let d = `M ${round1(pts[0][0])},${round1(pts[0][1])}`;
	for (let i = 0; i < pts.length - 1; i += 1) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		const c1x = p1[0] + (p2[0] - p0[0]) / 6;
		const c1y = p1[1] + (p2[1] - p0[1]) / 6;
		const c2x = p2[0] - (p3[0] - p1[0]) / 6;
		const c2y = p2[1] - (p3[1] - p1[1]) / 6;
		d += ` C ${round1(c1x)},${round1(c1y)} ${round1(c2x)},${round1(c2y)} ${round1(p2[0])},${round1(p2[1])}`;
	}
	return d;
};

const tickAlign = (i: number, n: number): string => {
	if (i === 0) {
		return "";
	}
	if (i === n - 1) {
		return "-translate-x-full";
	}
	return "-translate-x-1/2";
};

const tooltipShift = (idx: number, n: number): string => {
	const ratio = idx / (n - 1);
	if (ratio < 0.15) {
		return "-translate-x-[8%]";
	}
	if (ratio > 0.85) {
		return "-translate-x-[92%]";
	}
	return "-translate-x-1/2";
};

const useIsWide = (): boolean => {
	const [wide, setWide] = useState(
		() => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches,
	);
	useEffect(() => {
		const mq = window.matchMedia("(min-width: 640px)");
		const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return wide;
};

const MAX_BAR_W = 16;

/** Revenue bar width for `n` buckets, in viewBox units. */
const barWidth = (n: number): number => {
	const band = n > 1 ? (W - 12) / (n - 1) : W - 12;
	return Math.min(Math.max(band * 0.55, 1.5), MAX_BAR_W);
};

/**
 * Horizontal inset shared by the line and the bars: the first and last bars
 * are centred on the end buckets, so the inset must cover half a bar or the
 * edge bars get clipped by the SVG viewport.
 */
const chartInset = (n: number, withBars: boolean): number =>
	withBars ? Math.max(6, barWidth(n) / 2 + 4) : 6;

const xAt = (i: number, n: number, inset: number): number =>
	n > 1 ? inset + (i * (W - inset * 2)) / (n - 1) : W / 2;

const useGeometry = (points: Point[], wide: boolean, withBars: boolean) =>
	useMemo(() => {
		const n = points.length;
		const peak = Math.max(...points.map((p) => Math.max(p.current, p.previous ?? 0)));
		const max = niceMax(peak * 1.08);
		const inset = chartInset(n, withBars);
		const x = (i: number) => xAt(i, n, inset);
		const y = (v: number) => H - 8 - (v / max) * (H - 28);
		const cur = points.map((p, i) => [x(i), y(p.current)] as const);
		const prev = points.map((p, i) => [x(i), y(p.previous ?? 0)] as const);
		// Fewer ticks on phones; the last index is always labelled and, when it
		// sits too close to the previous tick, replaces it instead of colliding.
		const tickEvery = Math.ceil(n / (wide ? 8 : 4));
		const tickIdx: number[] = [];
		for (let i = 0; i < n; i += tickEvery) {
			tickIdx.push(i);
		}
		if (n > 0) {
			const prevTick = tickIdx.at(-1) ?? 0;
			if (n - 1 - prevTick <= tickEvery / 2) {
				tickIdx[tickIdx.length - 1] = n - 1;
			} else {
				tickIdx.push(n - 1);
			}
		}
		const ticks = tickIdx.map((i) => ({ i, left: (x(i) / W) * 100 }));
		const hasPrev = points.some((p) => (p.previous ?? 0) > 0);
		return {
			area: `${smoothPath(cur)} L ${W},${H} L 0,${H} Z`,
			hasPrev,
			lineCur: smoothPath(cur),
			linePrev: smoothPath(prev),
			max,
			n,
			ticks,
			x,
			y,
		};
	}, [points, wide, withBars]);

const useRevenueGeometry = (amounts: number[] | undefined) =>
	useMemo(() => {
		if (!amounts || amounts.length === 0) {
			return null;
		}
		const n = amounts.length;
		const peak = Math.max(...amounts, 0);
		// All-zero revenue still gets a usable right axis.
		const max = niceMax(Math.max(peak * 1.08, 1));
		const barW = barWidth(n);
		const inset = chartInset(n, true);
		const bars = amounts.map((v, i) => {
			const cx = xAt(i, n, inset);
			const h = (v / max) * (H - 28);
			return { h: v > 0 ? Math.max(h, 2) : 0, w: barW, x: cx - barW / 2 };
		});
		return { bars, max };
	}, [amounts]);

export const TrafficChart = ({
	points,
	annotations = [],
	revenue,
	currency,
}: {
	points: Point[];
	/** Day-marked annotations rendered as gold flags on the timeseries. */
	annotations?: { date: string; text: string }[];
	/** Revenue per bucket, aligned 1:1 with `points` — rendered as bars. */
	revenue?: number[];
	/** ISO code for the revenue axis and tooltip; USD when absent. */
	currency?: string;
}) => {
	const t = useT();
	const wide = useIsWide();
	const g = useGeometry(points, wide, Boolean(revenue?.length));
	const rev = useRevenueGeometry(revenue);
	const [hover, setHover] = useState<number | null>(null);
	const [hoverMarker, setHoverMarker] = useState<number | null>(null);
	const markers = useMemo(
		() =>
			annotations
				.map((a) => {
					const i = points.findIndex((p) => p.date?.slice(0, 10) === a.date.slice(0, 10));
					return i === -1 ? null : { date: a.date, i, label: a.text };
				})
				.filter((m) => m !== null),
		[annotations, points],
	);

	const onMove = (e: MouseEvent<HTMLDivElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		const idx = Math.round(((e.clientX - rect.left) / rect.width) * (g.n - 1));
		setHover(Math.min(g.n - 1, Math.max(0, idx)));
	};

	const onTouch = (e: TouchEvent<HTMLDivElement>) => {
		const t = e.touches[0] ?? e.changedTouches[0];
		if (!t) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const idx = Math.round(((t.clientX - rect.left) / rect.width) * (g.n - 1));
		setHover(Math.min(g.n - 1, Math.max(0, idx)));
	};

	const point = hover === null ? null : points[hover];
	const [first] = points;
	const last = points.at(-1);

	return (
		<div
			className="relative mb-5 h-52 w-full cursor-crosshair touch-pan-y md:h-60"
			onMouseMove={onMove}
			onMouseLeave={() => setHover(null)}
			onTouchStart={onTouch}
			onTouchMove={onTouch}
			onTouchEnd={() => setHover(null)}
		>
			<p className="sr-only">
				{t("chart.summary", { from: first?.full ?? "", to: last?.full ?? "" })}
			</p>
			<svg
				viewBox={`0 0 ${W} ${H}`}
				preserveAspectRatio="none"
				className="absolute inset-0 h-full w-full"
				aria-hidden
			>
				<defs>
					<linearGradient id="traffic-fill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--chart)" stopOpacity="0.26" />
						<stop offset="100%" stopColor="var(--chart)" stopOpacity="0" />
					</linearGradient>
				</defs>
				{[0.25, 0.5, 0.75].map((f) => (
					<line
						key={f}
						x1="0"
						x2={W}
						y1={H - 8 - f * (H - 28)}
						y2={H - 8 - f * (H - 28)}
						stroke="var(--grid)"
						vectorEffect="non-scaling-stroke"
					/>
				))}
				<path d={g.area} fill="url(#traffic-fill)" />
				{rev
					? rev.bars.map((b, i) =>
							b.h > 0 ? (
								<rect
									key={i}
									x={b.x}
									y={H - 8 - b.h}
									width={b.w}
									height={b.h}
									fill="var(--money)"
									fillOpacity={hover !== null && hover !== i ? 0.45 : 0.8}
								/>
							) : null,
						)
					: null}
				{g.hasPrev ? (
					<path
						d={g.linePrev}
						fill="none"
						stroke="var(--compare)"
						strokeWidth="2"
						strokeDasharray="5 5"
						vectorEffect="non-scaling-stroke"
					/>
				) : null}
				<path
					d={g.lineCur}
					fill="none"
					stroke="var(--chart)"
					strokeWidth="8"
					strokeOpacity="0.16"
					vectorEffect="non-scaling-stroke"
				/>
				<path
					d={g.lineCur}
					fill="none"
					stroke="var(--chart)"
					strokeWidth="2.5"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			{markers.map((m, idx) => (
				<div
					key={`${m.date}-${m.label}-${m.i}`}
					className="absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-help"
					style={{ left: `${(g.x(m.i) / W) * 100}%` }}
					onMouseEnter={() => setHoverMarker(idx)}
					onMouseLeave={() => setHoverMarker(null)}
				>
					<span
						className="bg-(--money)/40 absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
						aria-hidden
					/>
					<span
						className="bg-(--money) ring-card absolute top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-[2px] ring-2"
						aria-hidden
					/>
					{hoverMarker === idx ? (
						<div className="bg-popover/95 ring-foreground/10 pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-lg px-2 py-1.5 text-xs whitespace-nowrap ring-1 backdrop-blur">
							<p className="text-foreground/90 max-w-48 truncate font-medium">{m.label}</p>
							<p className="text-muted-foreground font-mono text-[10px]">{m.date}</p>
						</div>
					) : null}
				</div>
			))}

			<span className="text-muted-foreground/80 pointer-events-none absolute top-1 left-1 font-mono text-[11px] tabular-nums">
				{fmt(g.max)}
			</span>
			{rev ? (
				<span className="pointer-events-none absolute top-1 right-1 font-mono text-[11px] text-(--money) tabular-nums">
					{money(rev.max, currency)}
				</span>
			) : null}

			{point && hover !== null && (
				<>
					<div
						className="bg-foreground/25 pointer-events-none absolute inset-y-0 w-px"
						style={{ left: `${(g.x(hover) / W) * 100}%` }}
					/>
					<span
						className="ring-card pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--chart) ring-2"
						style={{
							left: `${(g.x(hover) / W) * 100}%`,
							top: `${(g.y(point.current) / H) * 100}%`,
						}}
					/>
					{g.hasPrev ? (
						<span
							className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-(--compare)"
							style={{
								left: `${(g.x(hover) / W) * 100}%`,
								top: `${(g.y(point.previous ?? 0) / H) * 100}%`,
							}}
						/>
					) : null}
					<div
						className={`bg-popover/95 ring-foreground/10 pointer-events-none absolute top-3 rounded-xl px-3 py-2 text-xs ring-1 backdrop-blur ${tooltipShift(hover, g.n)}`}
						style={{ left: `${(g.x(hover) / W) * 100}%` }}
					>
						<p className="text-foreground/90 mb-1 font-medium">{point.full}</p>
						<p className="flex items-center gap-2 font-mono tabular-nums">
							<span className="size-1.5 rounded-full bg-(--chart)" />
							{t("chart.visitors")} <span className="font-semibold">{fmt(point.current)}</span>
						</p>
						{rev ? (
							<p className="mt-0.5 flex items-center gap-2 font-mono tabular-nums">
								<span className="bg-(--money) size-1.5 rounded-[2px]" />
								{t("chart.revenue")}{" "}
								<span className="font-semibold">{money(revenue?.[hover] ?? 0, currency)}</span>
							</p>
						) : null}
						{g.hasPrev ? (
							<p className="text-muted-foreground mt-0.5 flex items-center gap-2 font-mono tabular-nums">
								<span className="size-1.5 rounded-full border border-dashed border-(--compare)" />
								{t("chart.previous")} <span>{fmt(point.previous ?? 0)}</span>
							</p>
						) : null}
					</div>
				</>
			)}
			<div className="pointer-events-none absolute inset-x-0 -bottom-5 h-4">
				{g.ticks.map(({ i, left }) => (
					<span
						key={points[i].label}
						className={`text-muted-foreground/80 absolute top-0 whitespace-nowrap font-mono text-[11px] tabular-nums ${tickAlign(i, g.n)}`}
						style={{ left: `${left}%` }}
					>
						{points[i].label}
					</span>
				))}
			</div>
		</div>
	);
};

/* -------------------------------- LP funnel -------------------------------- */

const FW = 1000;
const FH = 260;
const FLABEL = 48;
const FTOP = 44;
const FTAIL = 56;
const FHALF_MIN = 16;

const funnelBandColor = (i: number, n: number): string => {
	const t = n <= 1 ? 0 : i / (n - 1);
	// Traffic-orange ramp (hue of --chart): strongest at the mouth, fading
	// toward the card as the funnel narrows, so it reads as the same series
	// as the visitors line instead of a second palette.
	return `oklch(${(0.64 - 0.2 * t).toFixed(3)} ${(0.1 - 0.06 * t).toFixed(3)} 55)`;
};

export const FunnelChart = ({
	steps,
	rate,
}: {
	steps: {
		section: string;
		visitors: number;
		percentage: number;
		dropoff: number;
	}[];
	rate?: number;
}) => {
	const t = useT();
	const [hover, setHover] = useState<number | null>(null);
	const n = steps.length;
	const max = steps[0]?.visitors ?? 1;
	const cy = FTOP + (FH - FTOP) / 2;
	const stepW = n > 0 ? (FW - FTAIL) / n : FW;
	const halfHs = steps.map((s) =>
		Math.max(FHALF_MIN, ((FH - FTOP) / 2 - 8) * Math.min(1, s.visitors / max)),
	);
	const x0 = (i: number) => i * stepW;

	const bands = steps.map((s, i) => {
		// Each stage is a plateau at its own height with a short pinch (neck)
		// right after its start easing from the previous stage's height —
		// reads as distinct beads on a string, like the reference design.
		const h0 = halfHs[i];
		const prev = i > 0 ? halfHs[i - 1] : h0;
		const pinch = stepW * 0.3;
		const c1 = x0(i) + pinch * 0.35;
		const c2 = x0(i) + pinch * 0.65;
		const d = [
			`M ${x0(i)} ${cy - prev}`,
			`C ${c1} ${cy - prev}, ${c2} ${cy - h0}, ${x0(i) + pinch} ${cy - h0}`,
			`L ${x0(i) + stepW} ${cy - h0}`,
			`L ${x0(i) + stepW} ${cy + h0}`,
			`L ${x0(i) + pinch} ${cy + h0}`,
			`C ${c2} ${cy + h0}, ${c1} ${cy + prev}, ${x0(i)} ${cy + prev}`,
			"Z",
		].join(" ");
		return { ...s, color: funnelBandColor(i, n), d, h: h0, i };
	});
	const tailH = halfHs[n - 1] ?? 0;
	const tailX = x0(n - 1) + stepW;

	return (
		<div className="relative" onMouseLeave={() => setHover(null)}>
			<svg
				viewBox={`0 0 ${FW} ${FH + FLABEL}`}
				className="h-auto w-full"
				aria-label={
					rate === undefined ? t("funnel.aria", { n }) : t("funnel.ariaRate", { n, rate })
				}
			>
				<defs>
					{bands.map((b) => (
						<linearGradient key={b.section} id={`funnel-band-${b.i}`} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={b.color} stopOpacity="0.82" />
							<stop offset="100%" stopColor={b.color} stopOpacity="0.82" />
						</linearGradient>
					))}
				</defs>
				{n > 0 ? (
					<path
						d={`M ${tailX} ${cy - tailH} L ${FW} ${cy - tailH} L ${FW} ${cy + tailH} L ${tailX} ${cy + tailH} Z`}
						fill={funnelBandColor(Math.max(0, n - 1), n)}
						opacity="0.75"
					/>
				) : null}
				{bands.map((b) => (
					<g
						key={b.section}
						onMouseEnter={() => setHover(b.i)}
						className="cursor-default transition-opacity"
						opacity={hover === null || hover === b.i ? 1 : 0.4}
					>
						<path d={b.d} fill={`url(#funnel-band-${b.i})`} />
					</g>
				))}
			</svg>
			{bands
				.slice(0, -1)
				.filter((b) => (steps[b.i + 1]?.dropoff ?? 0) >= 1)
				.map((b) => (
					<span
						key={`seam-${b.section}`}
						className="bg-card ring-foreground/15 text-foreground/90 pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ring-1"
						style={{
							left: `${((x0(b.i + 1) + stepW * 0.15) / FW) * 100}%`,
						}}
					>
						−{steps[b.i + 1]?.dropoff ?? 0}% →
					</span>
				))}

			{rate !== undefined ? (
				<div className="pointer-events-none absolute top-2 right-2 hidden text-right sm:block">
					<p className="text-[13px] font-semibold tracking-tight">{t("funnel.rate", { rate })}</p>
				</div>
			) : null}

			{bands.map((b) => (
				<div
					key={`label-${b.section}`}
					className="pointer-events-none absolute -translate-x-1/2 text-center"
					style={{
						left: `${((x0(b.i) + stepW / 2) / FW) * 100}%`,
						maxWidth: `${(stepW / FW) * 100}%`,
						top: `${((FH + 6) / (FH + FLABEL)) * 100}%`,
					}}
				>
					<p className="text-[11px] font-semibold tabular-nums">
						{t("funnel.visitors", { count: fmt(b.visitors) })}
					</p>
					<p className="text-muted-foreground truncate text-[10px]">{b.section}</p>
				</div>
			))}

			{hover !== null && bands[hover] ? (
				<div className="bg-popover/95 ring-foreground/10 pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-xl px-3 py-2 text-xs ring-1 backdrop-blur">
					<span className="font-medium">{bands[hover].section}</span>
					<span className="text-muted-foreground font-mono tabular-nums">
						{" "}
						· {t("funnel.visitors", { count: fmt(bands[hover].visitors) })} ·{" "}
						{bands[hover].percentage}%
						{bands[hover].dropoff > 0
							? ` · ${t("funnel.dropoff", { pct: bands[hover].dropoff })}`
							: ""}
					</span>
				</div>
			) : null}
		</div>
	);
};

export const GlobePanel = ({
	markers,
}: {
	markers: { city: string; location: [number, number] }[];
}) => {
	const t = useT();
	const isDark = useTheme().resolvedTheme !== "light";
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const wrapRef = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(560);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) {
			return;
		}
		setWidth(el.clientWidth);
		const onResize = () => setWidth(el.clientWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || width < 40) {
			return;
		}
		let phi = 1.2;
		const globe = createGlobe(canvas, {
			baseColor: isDark ? [0.32, 0.33, 0.38] : [1, 1, 1],
			dark: isDark ? 1 : 0,
			devicePixelRatio: 2,
			diffuse: 1.15,
			glowColor: isDark ? [0.16, 0.17, 0.22] : [0.92, 0.92, 0.94],
			height: width * 2,
			mapBrightness: isDark ? 5.5 : 6,
			mapSamples: 16_000,
			markerColor: [0.96, 0.55, 0.25],
			markers: markers.map((m) => ({
				location: m.location,
				size: 0.055,
			})),
			opacity: 0.98,
			phi: 0,
			theta: 0.28,
			width: width * 2,
		});
		let raf = 0;
		const render = () => {
			phi += 0.0028;
			globe.update({ phi });
			raf = requestAnimationFrame(render);
		};
		raf = requestAnimationFrame(render);
		return () => {
			cancelAnimationFrame(raf);
			globe.destroy();
		};
	}, [width, markers, isDark]);

	return (
		<div>
			<div ref={wrapRef} className="relative flex justify-center">
				<canvas ref={canvasRef} aria-label={t("globe.aria")} />
			</div>
			<div className="border-border/60 text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
				{markers.slice(0, 4).map((m) => (
					<span key={m.city} className="flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-(--chart)" aria-hidden />
						{m.city}
					</span>
				))}
				<span className="ms-auto font-mono tabular-nums">
					{t("globe.regions", { n: markers.length })}
				</span>
			</div>
		</div>
	);
};

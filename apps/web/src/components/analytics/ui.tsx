import createGlobe from "cobe";
import {
  ArrowDownRight,
  ArrowDownUp,
  ArrowUpRight,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { fmt, niceMax } from "./data";
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
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: "good" | "bad";
}) => {
  const Arrow = tone === "good" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="bg-card ring-foreground/10 min-w-0 rounded-2xl px-3 py-2.5 ring-1">
      <p className="text-muted-foreground text-[13px]">{label}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[22px] leading-7 font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
            tone === "good"
              ? "bg-(--up)/10 text-(--up)"
              : "bg-(--down)/10 text-(--down)"
          }`}
        >
          <Arrow className="size-3" aria-hidden />
          {delta}
        </span>
      </div>
    </div>
  );
};

/* ------------------------------ panel wrappers ----------------------------- */

export const PanelTabs = <T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { readonly key: T; readonly label: string }[];
  value: T;
  onChange: (key: T) => void;
}) => (
  <div role="tablist" className="bg-muted/70 flex rounded-lg p-0.5">
    {tabs.map((t) => (
      <button
        key={t.key}
        type="button"
        role="tab"
        aria-selected={value === t.key}
        onClick={() => onChange(t.key)}
        className={`focus-visible:outline-ring rounded-md px-2 py-1 text-xs font-medium outline-offset-1 focus-visible:outline-2 ${
          value === t.key
            ? "bg-card text-foreground ring-foreground/10 ring-1"
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
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </div>
    {children}
  </section>
);

export const SortHint = ({
  label,
  dir,
  onToggle,
}: {
  label: string;
  dir?: "desc" | "asc";
  onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={`Sort by ${label}${dir ? (dir === "desc" ? ", high to low" : ", low to high") : ""}`}
    className="text-muted-foreground hover:text-foreground focus-visible:outline-ring inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs outline-offset-2 focus-visible:outline-2"
  >
    {label}
    <ArrowDownUp
      className={`size-3 ${dir === "asc" ? "rotate-180" : ""}`}
      aria-hidden
    />
  </button>
);

/* -------------------------------- bar rows --------------------------------- */

export const CountBarRow = ({
  glyph,
  label,
  value,
  share,
  fill = "var(--chart)",
}: {
  glyph?: ReactNode;
  label: string;
  value: string;
  share: number;
  fill?: string;
}) => (
  <div className="hover:bg-muted/60 bg-muted/40 relative h-9 overflow-hidden rounded-lg transition-colors">
    <div
      className="absolute inset-y-0 left-0 rounded-lg"
      style={{
        backgroundColor: `color-mix(in oklab, ${fill} 40%, transparent)`,
        width: `${share}%`,
      }}
    />
    <span className="absolute inset-0 flex items-center gap-2 px-2.5 text-[13px]">
      {glyph}
      <span className="truncate font-medium">{label}</span>
    </span>
    <span className="text-foreground/80 absolute inset-y-0 right-2.5 flex items-center font-mono text-xs tabular-nums">
      {value}
    </span>
  </div>
);

const deviceIconEl = (device: PlatformRow["device"]) => {
  if (device === "mobile") {
    return (
      <Smartphone
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    );
  }
  if (device === "tablet") {
    return (
      <Tablet className="text-muted-foreground size-4 shrink-0" aria-hidden />
    );
  }
  return (
    <Monitor className="text-muted-foreground size-4 shrink-0" aria-hidden />
  );
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

const useGeometry = (points: Point[]) =>
  useMemo(() => {
    const n = points.length;
    const peak = Math.max(
      ...points.map((p) => Math.max(p.current, p.previous ?? 0))
    );
    const max = niceMax(peak * 1.08);
    const x = (i: number) => 6 + (i * (W - 12)) / (n - 1);
    const y = (v: number) => H - 8 - (v / max) * (H - 28);
    const cur = points.map((p, i) => [x(i), y(p.current)] as const);
    const prev = points.map((p, i) => [x(i), y(p.previous ?? 0)] as const);
    const tickEvery = Math.ceil(n / 8);
    const ticks = points
      .map((_, i) => i)
      .filter((i) => i % tickEvery === 0)
      .map((i) => ({ i, left: (x(i) / W) * 100 }));
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
  }, [points]);

export const TrafficChart = ({
  points,
  annotations = [],
}: {
  points: Point[];
  /** Day-marked annotations rendered as gold flags on the timeseries. */
  annotations?: { date: string; text: string }[];
}) => {
  const g = useGeometry(points);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverMarker, setHoverMarker] = useState<number | null>(null);
  const markers = useMemo(
    () =>
      annotations
        .map((a) => {
          const i = points.findIndex(
            (p) => p.date?.slice(0, 10) === a.date.slice(0, 10)
          );
          return i === -1 ? null : { date: a.date, i, label: a.text };
        })
        .filter((m) => m !== null),
    [annotations, points]
  );

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.round(((e.clientX - rect.left) / rect.width) * (g.n - 1));
    setHover(Math.min(g.n - 1, Math.max(0, idx)));
  };

  const point = hover === null ? null : points[hover];
  const [first] = points;
  const last = points.at(-1);

  return (
    <div
      className="relative h-52 w-full cursor-crosshair md:h-60"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <p className="sr-only">
        Visitors trend, {first?.full} to {last?.full}, compared with the
        previous period.
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
            stroke="oklch(1 0 0 / 7%)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={g.area} fill="url(#traffic-fill)" />
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
              <p className="text-foreground/90 max-w-48 truncate font-medium">
                {m.label}
              </p>
              <p className="text-muted-foreground font-mono text-[10px]">
                {m.date}
              </p>
            </div>
          ) : null}
        </div>
      ))}

      <span className="text-muted-foreground/80 pointer-events-none absolute top-1 left-1 font-mono text-[11px] tabular-nums">
        {fmt(g.max)}
      </span>

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
              Visitors{" "}
              <span className="font-semibold">{fmt(point.current)}</span>
            </p>
            {g.hasPrev ? (
              <p className="text-muted-foreground mt-0.5 flex items-center gap-2 font-mono tabular-nums">
                <span className="size-1.5 rounded-full border border-dashed border-(--compare)" />
                Previous <span>{fmt(point.previous ?? 0)}</span>
              </p>
            ) : null}
            </div>
          </>
        )}

      <div className="pointer-events-none absolute inset-x-0 -bottom-5 h-4">
        {g.ticks.map(({ i, left }) => (
          <span
            key={points[i].label}
            className={`text-muted-foreground/80 absolute top-0 font-mono text-[11px] tabular-nums ${tickAlign(i, g.n)}`}
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
const FSEAM = 38;
const FTAIL = 56;
const FHALF_MIN = 16;

const funnelBandColor = (i: number, n: number): string => {
  const t = n <= 1 ? 0 : i / (n - 1);
  // Steel-blue ramp: dense at the mouth, paler as the funnel narrows.
  return `oklch(${(0.56 + 0.2 * t).toFixed(3)} ${(0.115 - 0.05 * t).toFixed(3)} 252)`;
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
  const [hover, setHover] = useState<number | null>(null);
  const n = steps.length;
  const max = steps[0]?.visitors ?? 1;
  const cy = FH / 2;
  const gap = n > 1 ? FSEAM : 0;
  const stepW = n > 0 ? (FW - FTAIL - gap * (n - 1)) / n : FW;
  const halfHs = steps.map((s) =>
    Math.max(FHALF_MIN, (cy - 10) * Math.min(1, s.visitors / max))
  );
  const x0 = (i: number) => i * (stepW + gap);

  const bands = steps.map((s, i) => {
    const h0 = halfHs[i];
    const h1 = i < n - 1 ? halfHs[i + 1] : h0;
    const curve = stepW * 0.4;
    const d = [
      `M ${x0(i)} ${cy - h0}`,
      `C ${x0(i) + curve} ${cy - h0}, ${x0(i) + stepW - curve} ${cy - h1}, ${x0(i) + stepW} ${cy - h1}`,
      `L ${x0(i) + stepW} ${cy + h1}`,
      `C ${x0(i) + stepW - curve} ${cy + h1}, ${x0(i) + curve} ${cy + h0}, ${x0(i)} ${cy + h0}`,
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
        aria-label={`Landing page scroll funnel, ${n} steps${rate !== undefined ? `, ${rate}% conversion` : ""}`}
      >
        <defs>
          {bands.map((b) => (
            <linearGradient
              key={b.section}
              id={`funnel-band-${b.i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
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
        .filter((b) => (steps[b.i + 1]?.dropoff ?? 0) > 0)
        .map((b) => (
        <span
          key={`seam-${b.section}`}
          className="bg-card ring-foreground/15 text-foreground/90 pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ring-1"
          style={{ left: `${((x0(b.i) + stepW + gap / 2) / FW) * 100}%` }}
        >
          −{steps[b.i + 1]?.dropoff ?? 0}% →
        </span>
      ))}

      {rate !== undefined ? (
        <div className="pointer-events-none absolute top-2 right-2 text-right">
          <p className="text-[13px] font-semibold tracking-tight">
            {rate}% conversion rate
          </p>
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
            {fmt(b.visitors)} visitors
          </p>
          <p className="text-muted-foreground truncate text-[10px]">
            {b.section}
          </p>
        </div>
      ))}

      {hover !== null && bands[hover] ? (
        <div className="bg-popover/95 ring-foreground/10 pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-xl px-3 py-2 text-xs ring-1 backdrop-blur">
          <span className="font-medium">{bands[hover].section}</span>
          <span className="text-muted-foreground font-mono tabular-nums">
            {" "}
            · {fmt(bands[hover].visitors)} visitors · {bands[hover].percentage}%
            {bands[hover].dropoff > 0
              ? ` · −${bands[hover].dropoff}% dropoff`
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
      baseColor: [0.32, 0.33, 0.38],
      dark: 1,
      devicePixelRatio: 2,
      diffuse: 1.15,
      glowColor: [0.16, 0.17, 0.22],
      height: width * 2,
      mapBrightness: 5.5,
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
  }, [width, markers]);

  return (
    <div>
      <div ref={wrapRef} className="relative flex justify-center">
        <canvas ref={canvasRef} aria-label="Globe of visitor locations" />
      </div>
      <div className="border-border/60 text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
        {markers.slice(0, 4).map((m) => (
          <span key={m.city} className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-(--chart)" aria-hidden />
            {m.city}
          </span>
        ))}
        <span className="ms-auto font-mono tabular-nums">
          {markers.length} active regions
        </span>
      </div>
    </div>
  );
};

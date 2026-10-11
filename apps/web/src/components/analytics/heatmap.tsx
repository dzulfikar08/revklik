import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchHeatmap, GrowthPlanLockedError } from "@/lib/legacy/growth";
import type { HeatmapData } from "@/lib/legacy/growth";
import { useT } from "@/lib/i18n";
import { fmt } from "./data";
import type { RangeKey } from "./data";
import { GrowthLocked, GrowthMsg } from "./growth-locked";
import { CodeSentence, CountBarRow, Panel } from "./ui";

/* 50x50 click grid painted like a page: blue (low) → orange (mid) → red (hot). */
const paintClickGrid = (canvas: HTMLCanvasElement, grid: number[][]): void => {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	const W = canvas.width;
	const H = canvas.height;
	ctx.clearRect(0, 0, W, H);

	ctx.strokeStyle = "rgba(255,255,255,0.03)";
	ctx.lineWidth = 1;
	for (let i = 0; i <= 50; i++) {
		const x = (i / 50) * W;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, H);
		ctx.stroke();
		const y = (i / 50) * H;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(W, y);
		ctx.stroke();
	}

	let maxVal = 0;
	for (const row of grid) {
		for (const v of row) {
			if (v > maxVal) {
				maxVal = v;
			}
		}
	}
	if (maxVal === 0) {
		return;
	}

	const cellW = W / 50;
	const cellH = H / 50;
	for (let r = 0; r < 50; r++) {
		for (let c = 0; c < 50; c++) {
			const v = grid[r]?.[c] ?? 0;
			if (v === 0) {
				continue;
			}
			const intensity = v / maxVal;
			const cx = c * cellW + cellW / 2;
			const cy = r * cellH + cellH / 2;
			const radius = cellW * 0.8 * (0.3 + intensity * 0.7);

			let color: string;
			if (intensity < 0.5) {
				const t = intensity * 2;
				const rr = Math.round(60 + t * 152);
				const gg = Math.round(165 - t * 29);
				const bb = Math.round(250 - t * 208);
				color = `rgba(${rr},${gg},${bb},${0.3 + intensity * 0.5})`;
			} else {
				const t = (intensity - 0.5) * 2;
				const rr = Math.round(212 + t * 27);
				const gg = Math.round(136 - t * 68);
				const bb = Math.round(42 + t * 26);
				color = `rgba(${rr},${gg},${bb},${0.4 + intensity * 0.5})`;
			}

			ctx.beginPath();
			ctx.arc(cx, cy, radius, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();
		}
	}
};

export const HeatmapPanel = ({
	onUpgrade,
	siteId,
	rangeKey,
	filterStr,
	topPages,
}: {
	onUpgrade: () => void;
	siteId: string;
	rangeKey: RangeKey;
	filterStr: string;
	topPages: { path: string }[];
}) => {
	const t = useT();
	const [path, setPath] = useState("/");
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const paths = useMemo(() => {
		const set = new Set(topPages.map((p) => p.path));
		set.add("/");
		return [...set];
	}, [topPages]);

	const q = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchHeatmap(siteId, path, rangeKey, filterStr),
		queryKey: ["growth", "heatmap", siteId, path, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const data = q.data;

	useEffect(() => {
		if (canvasRef.current && data?.clickGrid) {
			paintClickGrid(canvasRef.current, data.clickGrid);
		}
	}, [data]);

	const maxScroll = data ? Math.max(...data.scrollDepths.map((s) => s.visitors), 1) : 1;
	const maxElementClicks = data ? Math.max(...data.topElements.map((el) => el.clicks), 1) : 1;

	return (
		<Panel title="Heatmap" hint="clicks · scroll depth">
			{q.error instanceof GrowthPlanLockedError ? (
				<GrowthLocked
					blurb="See where visitors click and how far they scroll on every page."
					feature="Heatmaps"
					onUpgrade={onUpgrade}
				/>
			) : q.error ? (
				<GrowthMsg>{q.error.message}</GrowthMsg>
			) : (
				<>
					<div className="mb-2 flex flex-wrap items-center gap-2">
						<Select onValueChange={(v) => setPath(String(v))} value={path}>
							<SelectTrigger className="h-7 w-56 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="max-h-64">
								{paths.map((p) => (
									<SelectItem key={p} value={p}>
										{p}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{data ? (
							<span className="text-muted-foreground ml-auto flex items-center gap-3 font-mono text-xs tabular-nums">
								<span className="flex items-center gap-1">
									<MousePointerClick className="h-3.5 w-3.5" aria-hidden />
									{fmt(data.totalClicks)} clicks
								</span>
								<span>{fmt(data.totalSessions)} sessions</span>
							</span>
						) : null}
					</div>

					{q.isLoading ? (
						<div className="bg-muted/60 h-72 animate-pulse rounded-lg" />
					) : !data || data.totalClicks === 0 ? (
						<GrowthMsg>
							<CodeSentence
								template={t("heatmap.empty")}
								codes={{ attr: 'data-heatmap="true"', consent: "klikapa_consent.heatmap" }}
							/>
						</GrowthMsg>
					) : (
						<div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
							<div className="bg-background/40 ring-foreground/10 overflow-hidden rounded-xl ring-1">
								<canvas ref={canvasRef} width={600} height={760} className="h-auto w-full" />
							</div>
							<div className="flex min-w-0 flex-col gap-3">
								<div>
									<p className="text-muted-foreground mb-1.5 text-xs font-medium">Scroll depth</p>
									<div className="flex flex-col gap-1">
										{data.scrollDepths.map((s) => (
											<CountBarRow
												key={s.depth}
												label={`${s.depth}%`}
												share={(s.visitors / maxScroll) * 100}
												value={fmt(s.visitors)}
											/>
										))}
									</div>
								</div>
								{data.topElements.length > 0 ? (
									<div>
										<p className="text-muted-foreground mb-1.5 text-xs font-medium">
											Top clicked elements
										</p>
										<div className="flex flex-col gap-1">
											{data.topElements.slice(0, 10).map((el) => (
												<CountBarRow
													key={el.selector}
													label={el.label || el.selector}
													share={(el.clicks / maxElementClicks) * 100}
													value={fmt(el.clicks)}
												/>
											))}
										</div>
									</div>
								) : null}
							</div>
						</div>
					)}
				</>
			)}
		</Panel>
	);
};

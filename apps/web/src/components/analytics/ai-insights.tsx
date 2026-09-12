import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { fetchInsights, GrowthPlanLockedError, refreshInsights } from "@/lib/legacy/growth";
import type { InsightType, InsightsResponse } from "@/lib/legacy/growth";

import { fmtC, money } from "./data";
import { GrowthLocked, GrowthMsg, GrowthSkeleton } from "./growth-locked";
import { Panel } from "./ui";

const TYPE_GLYPHS: Record<InsightType, string> = {
	funnel_optimization: "▼",
	geo_opportunities: "◉",
	revenue_drivers: "$",
	revenue_prediction: "☘",
	traffic_roi: "↗",
};

const TYPE_COLORS: Record<InsightType, string> = {
	funnel_optimization: "var(--chart)",
	geo_opportunities: "var(--compare)",
	revenue_drivers: "var(--up)",
	revenue_prediction: "var(--money)",
	traffic_roi: "var(--violet)",
};

export const AiInsightsPanel = ({
	onUpgrade,
	siteId,
	rangeKey,
}: {
	onUpgrade: () => void;
	siteId: string;
	rangeKey: string;
}) => {
	const qc = useQueryClient();
	const q = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchInsights(siteId, rangeKey),
		queryKey: ["growth", "insights", siteId, rangeKey],
		refetchInterval: 300_000,
		retry: false,
		staleTime: 60_000,
	});

	const refresh = useMutation({
		mutationFn: () => refreshInsights(siteId, rangeKey),
		onError: (err) => {
			toast.error(
				err instanceof GrowthPlanLockedError
					? "AI insights are a Growth feature."
					: `Refresh failed: ${err.message}`,
			);
		},
		onSuccess: (data: InsightsResponse) => {
			qc.setQueryData(["growth", "insights", siteId, rangeKey], data);
			toast.success("Insights regenerated");
		},
	});

	const data = q.error instanceof GrowthPlanLockedError ? null : q.data;

	return (
		<Panel title="AI Insights" hint="updated every 5 min">
			{q.error instanceof GrowthPlanLockedError ? (
				<GrowthLocked
					blurb="Let AI surface what drives revenue and where funnel opportunities are hiding."
					feature="AI insights"
					onUpgrade={onUpgrade}
				/>
			) : q.error ? (
				<GrowthMsg>{q.error.message}</GrowthMsg>
			) : (
				<>
					<div className="mb-2 flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground flex items-center gap-1.5 text-xs">
							<Sparkles aria-hidden className="text-(--money) h-3.5 w-3.5" />
							{data?.data_summary
								? `${fmtC(data.data_summary.total_events)} events · ${money(
										data.data_summary.total_revenue / 100,
									)} revenue`
								: "patterns the dashboard won't show you"}
						</span>
						<button
							className="bg-muted hover:bg-muted/70 text-muted-foreground ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs transition-colors disabled:cursor-wait"
							disabled={refresh.isPending}
							onClick={() => refresh.mutate()}
							type="button"
						>
							<RefreshCw
								aria-hidden
								className={`h-3 w-3 ${refresh.isPending ? "animate-spin" : ""}`}
							/>
							{refresh.isPending ? "Generating…" : "Refresh"}
						</button>
					</div>

					{q.isLoading || refresh.isPending ? (
						<GrowthSkeleton rows={3} />
					) : !data || data.insights.length === 0 ? (
						<GrowthMsg>Not enough data yet. Check back after 100+ events.</GrowthMsg>
					) : (
						<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
							{data.insights.map((insight) => (
								<div
									className="bg-muted/40 flex items-start gap-2.5 rounded-lg p-3"
									key={insight.id}
								>
									<div
										className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold"
										style={{
											backgroundColor: `color-mix(in oklab, ${
												TYPE_COLORS[insight.type] ?? "var(--chart)"
											} 15%, transparent)`,
											color: TYPE_COLORS[insight.type] ?? "var(--chart)",
										}}
									>
										{TYPE_GLYPHS[insight.type] ?? "•"}
									</div>
									<div className="min-w-0 flex-1">
										<div className="mb-0.5 flex items-baseline gap-2">
											<span className="text-[13px] font-semibold">{insight.title}</span>
											<span className="text-muted-foreground ml-auto shrink-0 font-mono text-[10px] tabular-nums">
												{Math.round(insight.confidence * 100)}%
											</span>
										</div>
										<p className="text-muted-foreground text-xs leading-relaxed">
											{insight.summary}
										</p>
										{insight.action ? (
											<p className="text-(--chart) mt-1 font-mono text-[11px]">
												→ {insight.action}
											</p>
										) : null}
									</div>
								</div>
							))}
						</div>
					)}
				</>
			)}
		</Panel>
	);
};

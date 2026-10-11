import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import { fetchInsights, GrowthPlanLockedError, refreshInsights } from "@/lib/legacy/growth";
import type { AiInsight, InsightType, InsightsResponse } from "@/lib/legacy/growth";

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

/**
 * One insight: tinted type glyph, title, prose summary, then the recommended
 * action in the body font (it is a sentence, not code) behind a muted arrow.
 * Confidence sits under the title as quiet metadata, not beside it as a score.
 */
const InsightCard = ({ insight }: { insight: AiInsight }) => {
	const t = useT();
	const color = TYPE_COLORS[insight.type] ?? "var(--chart)";
	return (
		<li className="bg-muted/40 flex items-start gap-3 rounded-xl p-3">
			<span
				aria-hidden
				className="flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
				style={{
					backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)`,
					color,
				}}
			>
				{TYPE_GLYPHS[insight.type] ?? "•"}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[13px] leading-5 font-semibold text-pretty">{insight.title}</p>
				<p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
					{t("insights.confidence", { pct: Math.round(insight.confidence * 100) })}
				</p>
				<p className="text-foreground/80 mt-1.5 text-xs leading-relaxed text-pretty">
					{insight.summary}
				</p>
				{insight.action ? (
					<p className="text-muted-foreground mt-2 flex gap-1.5 text-xs leading-relaxed text-pretty">
						<ArrowRight aria-hidden className="mt-0.5 size-3 shrink-0 opacity-70" />
						<span>
							<span className="sr-only">{t("insights.action")} </span>
							{insight.action}
						</span>
					</p>
				) : null}
			</div>
		</li>
	);
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
						<span className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums">
							<Sparkles aria-hidden className="size-3.5 text-(--money)" />
							{data?.data_summary
								? `${fmtC(data.data_summary.total_events)} events · ${money(
										data.data_summary.total_revenue,
										data.data_summary.currency,
									)} revenue`
								: "patterns the dashboard won't show you"}
						</span>
						<button
							className="bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground focus-visible:outline-ring ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors outline-offset-2 focus-visible:outline-2 disabled:cursor-wait"
							disabled={refresh.isPending}
							onClick={() => refresh.mutate()}
							type="button"
						>
							<RefreshCw
								aria-hidden
								className={`size-3 ${refresh.isPending ? "animate-spin" : ""}`}
							/>
							{refresh.isPending ? "Generating…" : "Refresh"}
						</button>
					</div>

					{q.isLoading || refresh.isPending ? (
						<GrowthSkeleton rows={3} />
					) : !data || data.insights.length === 0 ? (
						<GrowthMsg>Not enough data yet. Check back after 100+ events.</GrowthMsg>
					) : (
						<ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
							{data.insights.map((insight) => (
								<InsightCard insight={insight} key={insight.id} />
							))}
						</ul>
					)}
				</>
			)}
		</Panel>
	);
};

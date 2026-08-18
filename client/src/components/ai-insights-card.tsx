import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InsightType } from "shared";
import { fetchInsights, refreshInsights } from "../lib/api";

const typeIcons: Record<InsightType, string> = {
	revenue_drivers: "$",
	geo_opportunities: "\u25C9",
	funnel_optimization: "\u25BC",
	traffic_roi: "\u2197",
	revenue_prediction: "\u2618",
};

const typeColors: Record<InsightType, string> = {
	revenue_drivers: "#34d399",
	geo_opportunities: "#60a5fa",
	funnel_optimization: "var(--accent)",
	traffic_roi: "#a78bfa",
	revenue_prediction: "#fb923c",
};

export function AiInsightsCard({
	siteId,
	range,
}: {
	siteId: string;
	range: string;
}) {
	const qc = useQueryClient();
	const { data, isLoading, error } = useQuery({
		queryKey: ["insights", siteId, range],
		queryFn: () => fetchInsights(siteId, range),
		refetchInterval: 300000,
	});

	const refresh = useMutation({
		mutationFn: () => refreshInsights(siteId, range),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: ["insights", siteId, range] }),
	});

	if (error) return null;

	return (
		<div
			style={{
				background: "var(--bg2)",
				border: "1px solid var(--border)",
				borderRadius: 12,
				padding: 20,
				marginBottom: 20,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 16,
					flexWrap: "wrap",
					gap: 8,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap",
					}}
				>
					<span style={{ fontSize: 18 }}>&#x2728;</span>
					<span style={{ fontWeight: 600, fontSize: 14 }}>AI Insights</span>
					{data?.data_summary && (
						<span
							style={{
								fontSize: 11,
								color: "var(--text3)",
								fontFamily: "var(--mono)",
							}}
						>
							{data.data_summary.total_events.toLocaleString()} events &middot;
							${(data.data_summary.total_revenue / 100).toFixed(2)} revenue
						</span>
					)}
				</div>
				<button type="button"
					onClick={() => refresh.mutate()}
					disabled={refresh.isPending}
					style={{
						background: "var(--bg3)",
						border: "1px solid var(--border2)",
						color: "var(--text2)",
						padding: "6px 14px",
						borderRadius: 100,
						fontSize: 12,
						cursor: "pointer",
						fontFamily: "var(--mono)",
						whiteSpace: "nowrap",
					}}
				>
					{refresh.isPending ? "Generating..." : "Refresh"}
				</button>
			</div>

			{isLoading || refresh.isPending ? (
				<div style={{ display: "grid", gap: 12 }}>
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							style={{
								background: "var(--bg3)",
								borderRadius: 8,
								padding: 16,
								height: 72,
								opacity: 0.5,
							}}
						/>
					))}
				</div>
			) : !data?.insights?.length ? (
				<div
					style={{
						color: "var(--text3)",
						fontSize: 13,
						textAlign: "center",
						padding: 24,
					}}
				>
					Not enough data yet. Check back after 100+ events.
				</div>
			) : (
				<div style={{ display: "grid", gap: 10 }}>
					{data.insights.map((insight) => (
						<div
							key={insight.title}
							style={{
								background: "var(--bg3)",
								borderRadius: 8,
								padding: 12,
								display: "flex",
								gap: 10,
								alignItems: "flex-start",
							}}
						>
							<div
								style={{
									width: 28,
									height: 28,
									borderRadius: 6,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									background: `${typeColors[insight.type]}20`,
									color: typeColors[insight.type],
									fontSize: 14,
									fontWeight: 700,
									flexShrink: 0,
								}}
							>
								{typeIcons[insight.type]}
							</div>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
									{insight.title}
								</div>
								<div
									style={{
										fontSize: 12,
										color: "var(--text2)",
										lineHeight: 1.5,
									}}
								>
									{insight.summary}
								</div>
								{insight.action && (
									<div
										style={{
											fontSize: 11,
											color: "var(--accent)",
											marginTop: 4,
											fontFamily: "var(--mono)",
										}}
									>
										&rarr; {insight.action}
									</div>
								)}
							</div>
							<div
								style={{
									fontSize: 10,
									color: "var(--text3)",
									fontFamily: "var(--mono)",
									flexShrink: 0,
								}}
							>
								{Math.round(insight.confidence * 100)}%
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

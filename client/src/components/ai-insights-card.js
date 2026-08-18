import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { fetchInsights, refreshInsights } from "../lib/api";

const typeIcons = {
	revenue_drivers: "$",
	geo_opportunities: "\u25C9",
	funnel_optimization: "\u25BC",
	traffic_roi: "\u2197",
};
const typeColors = {
	revenue_drivers: "#34d399",
	geo_opportunities: "#60a5fa",
	funnel_optimization: "var(--accent)",
	traffic_roi: "#a78bfa",
};
export function AiInsightsCard({ siteId, range }) {
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
	return _jsxs("div", {
		style: {
			background: "var(--bg2)",
			border: "1px solid var(--border)",
			borderRadius: 12,
			padding: 20,
			marginBottom: 20,
		},
		children: [
			_jsxs("div", {
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 16,
					flexWrap: "wrap",
					gap: 8,
				},
				children: [
					_jsxs("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							flexWrap: "wrap",
						},
						children: [
							_jsx("span", { style: { fontSize: 18 }, children: "\u2728" }),
							_jsx("span", {
								style: { fontWeight: 600, fontSize: 14 },
								children: "AI Insights",
							}),
							data?.data_summary &&
								_jsxs("span", {
									style: {
										fontSize: 11,
										color: "var(--text3)",
										fontFamily: "var(--mono)",
									},
									children: [
										data.data_summary.total_events.toLocaleString(),
										" events \u00B7 $",
										(data.data_summary.total_revenue / 100).toFixed(2),
										" revenue",
									],
								}),
						],
					}),
					_jsx("button", {
						onClick: () => refresh.mutate(),
						disabled: refresh.isPending,
						style: {
							background: "var(--bg3)",
							border: "1px solid var(--border2)",
							color: "var(--text2)",
							padding: "6px 14px",
							borderRadius: 100,
							fontSize: 12,
							cursor: "pointer",
							fontFamily: "var(--mono)",
							whiteSpace: "nowrap",
						},
						children: refresh.isPending ? "Generating..." : "Refresh",
					}),
				],
			}),
			isLoading || refresh.isPending
				? _jsx("div", {
						style: { display: "grid", gap: 12 },
						children: [1, 2, 3].map((i) =>
							_jsx(
								"div",
								{
									style: {
										background: "var(--bg3)",
										borderRadius: 8,
										padding: 16,
										height: 72,
										opacity: 0.5,
									},
								},
								i,
							),
						),
					})
				: !data?.insights?.length
					? _jsx("div", {
							style: {
								color: "var(--text3)",
								fontSize: 13,
								textAlign: "center",
								padding: 24,
							},
							children: "Not enough data yet. Check back after 100+ events.",
						})
					: _jsx("div", {
							style: { display: "grid", gap: 10 },
							children: data.insights.map((insight, i) =>
								_jsxs(
									"div",
									{
										style: {
											background: "var(--bg3)",
											borderRadius: 8,
											padding: 12,
											display: "flex",
											gap: 10,
											alignItems: "flex-start",
										},
										children: [
											_jsx("div", {
												style: {
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
												},
												children: typeIcons[insight.type],
											}),
											_jsxs("div", {
												style: { flex: 1, minWidth: 0 },
												children: [
													_jsx("div", {
														style: {
															fontWeight: 600,
															fontSize: 13,
															marginBottom: 2,
														},
														children: insight.title,
													}),
													_jsx("div", {
														style: {
															fontSize: 12,
															color: "var(--text2)",
															lineHeight: 1.5,
														},
														children: insight.summary,
													}),
													insight.action &&
														_jsxs("div", {
															style: {
																fontSize: 11,
																color: "var(--accent)",
																marginTop: 4,
																fontFamily: "var(--mono)",
															},
															children: ["\u2192 ", insight.action],
														}),
												],
											}),
											_jsxs("div", {
												style: {
													fontSize: 10,
													color: "var(--text3)",
													fontFamily: "var(--mono)",
													flexShrink: 0,
												},
												children: [Math.round(insight.confidence * 100), "%"],
											}),
										],
									},
									i,
								),
							),
						}),
		],
	});
}

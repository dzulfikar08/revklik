// Metric and chart card components

import {
	Area,
	Bar,
	CartesianGrid,
	ComposedChart,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import type { RevenueTimeSeriesPoint, StatsChange } from "@revklik/shared";
import { t } from "@/lib/i18n";

export function MetricCard({
	label,
	value,
	loading,
	change,
	invertChange,
}: {
	label: string;
	value: string;
	loading?: boolean;
	/** Period-over-period delta; renders ▲/▼ badge under the value */
	change?: StatsChange;
	/** true when a decrease is good (e.g. bounce rate) */
	invertChange?: boolean;
}) {
	const pct = change?.changePct ?? null;
	const showDelta = !loading && change !== undefined && pct !== null;
	const deltaGood = pct === null || pct === 0 ? null : invertChange ? pct < 0 : pct > 0;
	return (
		<div className="metric-card">
			<span className="metric-label">{label}</span>
			{loading ? (
				<div
					style={{
						width: 50,
						height: 22,
						borderRadius: 4,
						background: "var(--border)",
						animation: "pulse 1.5s infinite",
						marginTop: 4,
					}}
				/>
			) : (
				<>
					<span className="metric-value">{value}</span>
					{showDelta && change && pct !== null && (
						<span
							title={`vs ${change.previous.toLocaleString()} previous period`}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 3,
								marginTop: 2,
								fontSize: 11,
								fontFamily: "var(--mono)",
								color:
									deltaGood === null ? "var(--text3)" : deltaGood ? "var(--green)" : "var(--red)",
							}}
						>
							{pct > 0 ? "▲" : pct < 0 ? "▼" : "–"} {Math.abs(pct)}%
						</span>
					)}
				</>
			)}
		</div>
	);
}

export function ChartCard({
	data,
	revenueTimeseries,
	loading,
}: {
	data: { date: string; pageviews: number; visitors: number }[];
	revenueTimeseries?: RevenueTimeSeriesPoint[];
	loading: boolean;
}) {
	if (loading) {
		return (
			<div
				className="chart-wrap"
				style={{
					height: 200,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div className="spinner" />
			</div>
		);
	}
	if (!data || data.length === 0) {
		return (
			<div
				className="chart-wrap"
				style={{
					height: 200,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "var(--text3)",
					fontSize: 13,
				}}
			>
				{t("chart.no_data")}
			</div>
		);
	}
	const revenueMap = new Map((revenueTimeseries ?? []).map((r) => [r.date, r]));
	const hasRevenue = revenueMap.size > 0;
	const baseMap = new Map(
		data.map((row) => {
			const label = row.date.includes("T")
				? row.date.substring(row.date.indexOf("T") > 4 ? 5 : 0, 16)
				: row.date.substring(5);
			return [row.date, { ...row, label, revenue: 0, conversions: 0 }];
		}),
	);
	for (const [key, rev] of revenueMap) {
		const existing = baseMap.get(key);
		if (existing) {
			existing.revenue = rev.revenue;
			existing.conversions = rev.conversions;
		} else {
			const label = key.includes("T") ? key.substring(5, 16) : key.substring(5);
			baseMap.set(key, {
				date: key,
				label,
				pageviews: 0,
				visitors: 0,
				revenue: rev.revenue,
				conversions: rev.conversions,
			});
		}
	}
	const chartData = [...baseMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

	return (
		<div className="chart-wrap">
			<div className="chart-label">{t("chart.pageviews_visitors")}</div>
			<div style={{ height: 180 }}>
				<ResponsiveContainer width="100%" height="100%">
					<ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
						<defs>
							<linearGradient id="gpv" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
								<stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
							</linearGradient>
							<linearGradient id="gvs" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="var(--info)" stopOpacity={0.12} />
								<stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
							</linearGradient>
						</defs>
						<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
						<XAxis
							dataKey="label"
							tick={{
								fontSize: 10,
								fill: "var(--text3)",
								fontFamily: "var(--mono)",
							}}
							tickLine={false}
							axisLine={false}
							interval="preserveStartEnd"
						/>
						<YAxis
							yAxisId="left"
							tick={{
								fontSize: 10,
								fill: "var(--text3)",
								fontFamily: "var(--mono)",
							}}
							tickLine={false}
							axisLine={false}
							width={32}
						/>
						{hasRevenue && (
							<YAxis
								yAxisId="right"
								orientation="right"
								tick={{
									fontSize: 10,
									fill: "var(--text3)",
									fontFamily: "var(--mono)",
								}}
								tickLine={false}
								axisLine={false}
								width={40}
								tickFormatter={(v: number) => `$${v}`}
							/>
						)}
						<RechartsTooltip
							content={({ active, payload, label: lbl }) => {
								if (!active || !payload?.length) return null;
								const d = payload[0]?.payload;
								const vis = d?.visitors ?? 0;
								const rev = d?.revenue ?? 0;
								const conv = d?.conversions ?? 0;
								const revPerVis = vis > 0 ? rev / vis : 0;
								const convRate = vis > 0 ? (conv / vis) * 100 : 0;
								return (
									<div
										style={{
											background: "var(--bg2)",
											border: "1px solid var(--border2)",
											borderRadius: 8,
											fontSize: 11,
											color: "var(--text)",
											boxShadow: "0 8px 24px rgba(0,0,0,.4)",
											padding: "8px 12px",
											minWidth: 140,
										}}
									>
										<div
											style={{
												color: "var(--text3)",
												marginBottom: 4,
												fontSize: 11,
											}}
										>
											{lbl}
										</div>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												gap: 12,
											}}
										>
											<span>Visitors</span>
											<span style={{ fontFamily: "var(--mono)" }}>{vis.toLocaleString()}</span>
										</div>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												gap: 12,
											}}
										>
											<span>Pageviews</span>
											<span style={{ fontFamily: "var(--mono)" }}>
												{(d?.pageviews ?? 0).toLocaleString()}
											</span>
										</div>
										{hasRevenue && (
											<>
												<div
													style={{
														borderTop: "1px solid var(--border)",
														margin: "4px 0",
													}}
												/>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														gap: 12,
													}}
												>
													<span style={{ color: "var(--green)" }}>Revenue</span>
													<span
														style={{
															fontFamily: "var(--mono)",
															color: "var(--green)",
														}}
													>
														${rev.toFixed(2)}
													</span>
												</div>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														gap: 12,
													}}
												>
													<span>Conversions</span>
													<span style={{ fontFamily: "var(--mono)" }}>{conv}</span>
												</div>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														gap: 12,
													}}
												>
													<span>Rev/visitor</span>
													<span style={{ fontFamily: "var(--mono)" }}>${revPerVis.toFixed(2)}</span>
												</div>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														gap: 12,
													}}
												>
													<span>Conv. rate</span>
													<span style={{ fontFamily: "var(--mono)" }}>{convRate.toFixed(2)}%</span>
												</div>
											</>
										)}
									</div>
								);
							}}
						/>
						{hasRevenue && (
							<Bar
								yAxisId="right"
								dataKey="revenue"
								fill="#e8793a"
								fillOpacity={0.85}
								radius={[4, 4, 0, 0]}
								barSize={data.length > 48 ? 4 : data.length > 24 ? 8 : 14}
							/>
						)}
						<Area
							yAxisId="left"
							type="monotone"
							dataKey="visitors"
							stroke="#60a5fa"
							strokeWidth={2}
							fill="url(#gvs)"
							dot={false}
							activeDot={{ r: 3, strokeWidth: 0 }}
						/>
					</ComposedChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

export function formatTime(ts: string) {
	const d = new Date(ts);
	return d.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function timeAgo(ts: string): string {
	const diff = Date.now() - new Date(ts).getTime();
	if (diff < 60000) return "just now";
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	return `${Math.floor(diff / 86400000)}d ago`;
}

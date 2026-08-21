// Revenue breakdown widgets

import { useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import type {
	ChannelEntry,
	RevenueByCountry,
	RevenueByPaymentMethod,
	RevenueByPaymentProvider,
	RevenueBySource,
	RevenueTimeSeriesPoint,
	VisitorJourney,
} from "@revklik/shared";
import { avatarUrl, nameFromVisitorId } from "./icons";

type RevenueTab = "source" | "country" | "trend" | "method" | "provider" | "customers";

export function RevenueBreakdownWidget({
	bySource,
	byCountry,
	trend,
	byMethod,
	byProvider,
	journeys,
	onCrossFilter,
	onSelectCustomer,
}: {
	bySource: RevenueBySource[];
	byCountry: RevenueByCountry[];
	trend: RevenueTimeSeriesPoint[];
	byMethod: RevenueByPaymentMethod[];
	byProvider: RevenueByPaymentProvider[];
	journeys?: VisitorJourney[];
	onCrossFilter?: (dimension: string, value: string) => void;
	onSelectCustomer?: (journey: VisitorJourney) => void;
}) {
	const [tab, setTab] = useState<RevenueTab>("source");
	const [buyerFilter, setBuyerFilter] = useState<{
		dim: "utm_source" | "country";
		value: string;
		label: string;
	} | null>(null);

	return (
		<div
			className="data-table-card"
			style={{
				border: "none",
				background: "transparent",
				display: "flex",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 6,
				}}
			>
				<span className="data-table-title" style={{ marginBottom: 0 }}>
					Revenue
				</span>
				<div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
					{(
						[
							["source", "Source"],
							["country", "Country"],
							["trend", "Trend"],
							["method", "Method"],
							["provider", "Provider"],
							["customers", "Customers"],
						] as [RevenueTab, string][]
					).map(([key, label]) => (
						<button
							type="button"
							key={key}
							onClick={() => setTab(key)}
							style={{
								fontSize: 10,
								padding: "2px 8px",
								borderRadius: 4,
								border: "none",
								cursor: "pointer",
								fontFamily: "var(--mono)",
								background: tab === key ? "var(--accent-dim)" : "transparent",
								color: tab === key ? "var(--accent)" : "var(--text3)",
							}}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			{tab === "trend" ? (
				trend.length === 0 ? (
					<div
						style={{
							padding: 16,
							color: "var(--text3)",
							fontSize: 12,
							textAlign: "center",
						}}
					>
						No revenue data
					</div>
				) : (
					<div style={{ flex: 1, minHeight: 0 }}>
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={trend} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
								<XAxis
									dataKey="date"
									tick={{ fontSize: 10, fill: "var(--text3)" }}
									tickFormatter={(v: string) => v.slice(5)}
								/>
								<YAxis
									tick={{ fontSize: 10, fill: "var(--text3)" }}
									tickFormatter={(v: number) => `$${v}`}
								/>
								<RechartsTooltip
									contentStyle={{
										background: "var(--bg2)",
										border: "1px solid var(--border)",
										borderRadius: 8,
										fontSize: 12,
									}}
									formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, "Revenue"]}
								/>
								<Area
									type="monotone"
									dataKey="revenue"
									stroke="var(--accent)"
									fill="var(--accent-dim)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>
				)
			) : tab === "method" ? (
				byMethod.length === 0 ? (
					<div
						style={{
							padding: 16,
							color: "var(--text3)",
							fontSize: 12,
							textAlign: "center",
						}}
					>
						No payment method data
					</div>
				) : (
					<div style={{ flex: 1, overflowY: "auto" }}>
						<table className="data-table">
							<thead>
								<tr>
									<th>Method</th>
									<th style={{ textAlign: "right" }}>Count</th>
									<th style={{ textAlign: "right" }}>Revenue</th>
								</tr>
							</thead>
							<tbody>
								{byMethod.map((r) => (
									<tr key={r.method}>
										<td style={{ fontSize: 12 }}>{r.method}</td>
										<td
											style={{
												textAlign: "right",
												fontFamily: "var(--mono)",
												fontSize: 11,
											}}
										>
											{r.count}
										</td>
										<td
											style={{
												textAlign: "right",
												fontFamily: "var(--mono)",
												fontSize: 11,
											}}
										>
											${r.revenue.toFixed(2)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)
			) : tab === "provider" ? (
				byProvider.length === 0 ? (
					<div
						style={{
							padding: 16,
							color: "var(--text3)",
							fontSize: 12,
							textAlign: "center",
						}}
					>
						No payment provider data
					</div>
				) : (
					<div style={{ flex: 1, overflowY: "auto" }}>
						<table className="data-table">
							<thead>
								<tr>
									<th>Provider</th>
									<th style={{ textAlign: "right" }}>Count</th>
									<th style={{ textAlign: "right" }}>Revenue</th>
								</tr>
							</thead>
							<tbody>
								{byProvider.map((r) => (
									<tr key={r.provider}>
										<td style={{ fontSize: 12 }}>{r.provider}</td>
										<td
											style={{
												textAlign: "right",
												fontFamily: "var(--mono)",
												fontSize: 11,
											}}
										>
											{r.count}
										</td>
										<td
											style={{
												textAlign: "right",
												fontFamily: "var(--mono)",
												fontSize: 11,
											}}
										>
											${r.revenue.toFixed(2)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)
			) : tab === "customers" ? (
				(() => {
					const buyers = (journeys ?? [])
						.filter((j) => j.total_revenue > 0)
						.filter((j) =>
							!buyerFilter
								? true
								: buyerFilter.dim === "utm_source"
									? (j.utm_source ?? "") === buyerFilter.value
									: (j.country ?? "") === buyerFilter.value,
						)
						.sort((a, b) => b.total_revenue - a.total_revenue);
					if (buyers.length === 0)
						return (
							<div
								style={{
									padding: 16,
									color: "var(--text3)",
									fontSize: 12,
									textAlign: "center",
								}}
							>
								No paying customers in this range
							</div>
						);
					return (
						<div style={{ flex: 1, overflowY: "auto" }}>
							{buyerFilter && (
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										marginBottom: 6,
										fontSize: 11,
									}}
								>
									<span style={{ color: "var(--text3)" }}>
										Filtered by {buyerFilter.dim === "utm_source" ? "source" : "country"}:
									</span>
									<span style={{ color: "var(--accent)" }}>{buyerFilter.label}</span>
									<button
										type="button"
										className="btn-pill"
										style={{ fontSize: 10, padding: "1px 6px" }}
										onClick={() => setBuyerFilter(null)}
									>
										clear
									</button>
								</div>
							)}
							{buyers.map((j) => {
								const name = j.visitor_name || nameFromVisitorId(j.visitor_id);
								return (
									<button
										type="button"
										key={j.session_id}
										onClick={() => onSelectCustomer?.(j)}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
											width: "100%",
											padding: "6px 4px",
											background: "transparent",
											border: "none",
											cursor: "pointer",
											borderBottom: "1px solid var(--border)",
										}}
									>
										<img
											src={avatarUrl(name)}
											alt=""
											style={{
												width: 22,
												height: 22,
												borderRadius: "50%",
												background: "var(--bg3)",
												flexShrink: 0,
											}}
										/>
										<span
											style={{
												flex: 1,
												textAlign: "left",
												fontSize: 12,
												color: "var(--text)",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{name}
										</span>
										{j.country && (
											<span style={{ fontSize: 11, color: "var(--text3)" }}>{j.country}</span>
										)}
										<span
											style={{
												fontFamily: "var(--mono)",
												fontSize: 11,
												color: "var(--green)",
											}}
										>
											${j.total_revenue.toFixed(2)}
										</span>
										<span style={{ fontSize: 10, color: "var(--text4)" }}>
											{j.steps.length} steps
										</span>
									</button>
								);
							})}
						</div>
					);
				})()
			) : (tab === "source" ? bySource : byCountry).length === 0 ? (
				<div
					style={{
						padding: 16,
						color: "var(--text3)",
						fontSize: 12,
						textAlign: "center",
					}}
				>
					No revenue data
				</div>
			) : (
				<div style={{ flex: 1, overflowY: "auto" }}>
					<table className="data-table">
						<thead>
							<tr>
								<th>{tab === "source" ? "Source" : "Country"}</th>
								<th style={{ textAlign: "right" }}>Revenue</th>
								<th style={{ textAlign: "right" }}>Conv.</th>
							</tr>
						</thead>
						<tbody>
							{(tab === "source" ? bySource : byCountry).map((r) => (
								<tr
									key={"source" in r ? r.source : r.country}
									style={{ cursor: onCrossFilter || onSelectCustomer ? "pointer" : undefined }}
									onClick={() => {
										const val = "source" in r ? r.source : r.country;
										const dim = tab === "source" ? "utm_source" : "country";
										if (onSelectCustomer) {
											// Drill into the Customers tab pre-filtered to this row.
											setBuyerFilter({
												dim: dim as "utm_source" | "country",
												value: val,
												label: val,
											});
											setTab("customers");
											return;
										}
										if (onCrossFilter) onCrossFilter(dim, val);
									}}
								>
									<td style={{ fontSize: 13 }}>{"source" in r ? r.source : r.country}</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											fontSize: 12,
										}}
									>
										${r.revenue.toFixed(2)}
									</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											fontSize: 12,
										}}
									>
										{r.conversions}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

export function ChannelBreakdownWidget({ data }: { data: ChannelEntry[] }) {
	if (data.length === 0)
		return (
			<div
				style={{
					padding: 16,
					color: "var(--text3)",
					fontSize: 12,
					textAlign: "center",
				}}
			>
				No channel data
			</div>
		);
	const maxVisitors = Math.max(...data.map((d) => d.visitors)) || 1;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			{data.map((d) => (
				<div
					key={d.channel}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 12,
					}}
				>
					<span style={{ width: 100, color: "var(--text2)", flexShrink: 0 }}>{d.channel}</span>
					<div
						style={{
							flex: 1,
							background: "var(--bg3)",
							borderRadius: 4,
							height: 18,
							overflow: "hidden",
						}}
					>
						<div
							style={{
								width: `${(d.visitors / maxVisitors) * 100}%`,
								height: "100%",
								background: "var(--accent)",
								borderRadius: 4,
								minWidth: 2,
							}}
						/>
					</div>
					<span
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11,
							color: "var(--text2)",
							width: 50,
							textAlign: "right",
						}}
					>
						{d.visitors}
					</span>
					<span
						style={{
							fontFamily: "var(--mono)",
							fontSize: 10,
							color: "var(--text3)",
							width: 35,
							textAlign: "right",
						}}
					>
						{d.percentage}%
					</span>
				</div>
			))}
		</div>
	);
}

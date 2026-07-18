import {
	Fragment as _Fragment,
	jsx as _jsx,
	jsxs as _jsxs,
} from "react/jsx-runtime";

const PLAN_LIMITS = {
	starter: { limit: 10_000, price: 4, name: "Starter" },
	growth: { limit: 100_000, price: 12, name: "Growth" },
};
function getDaysInMonth() {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
function getDaysElapsed() {
	const now = new Date();
	return now.getDate();
}
function formatNumber(n) {
	return Math.round(n).toLocaleString();
}
export function EventCalculator({ currentEvents, currentPlan }) {
	const daysInMonth = getDaysInMonth();
	const daysElapsed = Math.max(getDaysElapsed(), 1);
	const plan = PLAN_LIMITS[currentPlan];
	const projected = Math.round((currentEvents / daysElapsed) * daysInMonth);
	const pct = Math.min((currentEvents / plan.limit) * 100, 100);
	const willExceed = projected > plan.limit;
	let barColor;
	if (pct < 70) barColor = "var(--green)";
	else if (pct < 90) barColor = "var(--accent)";
	else barColor = "#ef4444";
	return _jsxs("div", {
		style: {
			background: "var(--bg2)",
			border: "1px solid var(--border)",
			borderRadius: 12,
			padding: "14px 16px",
			marginBottom: 16,
		},
		children: [
			_jsxs("div", {
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 12,
					flexWrap: "wrap",
					gap: 6,
				},
				children: [
					_jsx("span", {
						style: { fontWeight: 600, fontSize: 14 },
						children: "Event Usage This Month",
					}),
					_jsx("span", {
						style: {
							fontFamily: "var(--mono)",
							fontSize: 10,
							fontWeight: 600,
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							padding: "3px 10px",
							borderRadius: 100,
							background:
								currentPlan === "growth" ? "var(--accent-dim)" : "var(--bg3)",
							color:
								currentPlan === "growth" ? "var(--accent)" : "var(--text3)",
							border: `1px solid ${currentPlan === "growth" ? "var(--accent-mid)" : "var(--border2)"}`,
						},
						children: plan.name,
					}),
				],
			}),
			_jsxs("div", {
				style: { marginBottom: 10 },
				children: [
					_jsx("div", {
						style: {
							height: 8,
							borderRadius: 100,
							background: "var(--bg3)",
							overflow: "hidden",
						},
						children: _jsx("div", {
							style: {
								height: "100%",
								width: `${Math.min(pct, 100)}%`,
								borderRadius: 100,
								background: barColor,
								transition: "width 0.5s ease",
							},
						}),
					}),
					_jsxs("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							marginTop: 6,
							fontFamily: "var(--mono)",
							fontSize: 11,
							color: "var(--text2)",
						},
						children: [
							_jsxs("span", {
								children: [
									formatNumber(currentEvents),
									" / ",
									formatNumber(plan.limit),
								],
							}),
							_jsxs("span", {
								style: {
									color:
										pct >= 90
											? "#ef4444"
											: pct >= 70
												? "var(--accent)"
												: "var(--text3)",
								},
								children: [pct.toFixed(0), "%"],
							}),
						],
					}),
				],
			}),
			_jsx("div", {
				style: {
					fontSize: 12,
					color: willExceed ? "#ef4444" : "var(--text2)",
					fontFamily: "var(--mono)",
					lineHeight: 1.6,
					padding: "8px 12px",
					background: willExceed ? "rgba(239,68,68,.08)" : "var(--bg3)",
					borderRadius: 8,
					border: willExceed
						? "1px solid rgba(239,68,68,.15)"
						: "1px solid var(--border)",
				},
				children: willExceed
					? _jsxs(_Fragment, {
							children: [
								_jsxs("span", {
									style: { fontWeight: 600 },
									children: [
										"Projected: ~",
										formatNumber(projected),
										" events",
									],
								}),
								_jsxs("span", {
									style: { display: "block", marginTop: 2, fontSize: 11 },
									children: [
										"You'll exceed your ",
										plan.name,
										" plan (",
										formatNumber(plan.limit),
										" events)",
									],
								}),
								currentPlan === "starter" &&
									_jsx("span", {
										style: {
											display: "block",
											marginTop: 4,
											fontSize: 11,
											color: "var(--accent)",
										},
										children:
											"Consider upgrading to Growth ($12/mo for 100K events)",
									}),
							],
						})
					: _jsxs(_Fragment, {
							children: [
								_jsxs("span", {
									style: { color: "var(--text2)" },
									children: [
										"Projected: ~",
										formatNumber(projected),
										" events",
									],
								}),
								_jsxs("span", {
									style: { color: "var(--green)", marginLeft: 6 },
									children: ["within your ", plan.name, " plan"],
								}),
							],
						}),
			}),
		],
	});
}

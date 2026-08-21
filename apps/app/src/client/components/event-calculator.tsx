interface EventCalculatorProps {
	currentEvents: number;
	currentPlan: "starter" | "growth";
}

const PLAN_LIMITS = {
	starter: { limit: 10_000, price: 4, name: "Starter" },
	growth: { limit: 100_000, price: 12, name: "Growth" },
};

function getDaysInMonth(): number {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

function getDaysElapsed(): number {
	const now = new Date();
	return now.getDate();
}

function formatNumber(n: number): string {
	return Math.round(n).toLocaleString();
}

export function EventCalculator({ currentEvents, currentPlan }: EventCalculatorProps) {
	const daysInMonth = getDaysInMonth();
	const daysElapsed = Math.max(getDaysElapsed(), 1);
	const plan = PLAN_LIMITS[currentPlan];

	const projected = Math.round((currentEvents / daysElapsed) * daysInMonth);
	const pct = Math.min((currentEvents / plan.limit) * 100, 100);
	const willExceed = projected > plan.limit;

	let barColor: string;
	if (pct < 70) barColor = "var(--green)";
	else if (pct < 90) barColor = "var(--accent)";
	else barColor = "#ef4444";

	return (
		<div
			style={{
				background: "var(--bg2)",
				border: "1px solid var(--border)",
				borderRadius: 12,
				padding: "14px 16px",
				marginBottom: 16,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 12,
					flexWrap: "wrap",
					gap: 6,
				}}
			>
				<span style={{ fontWeight: 600, fontSize: 14 }}>Event Usage This Month</span>
				<span
					style={{
						fontFamily: "var(--mono)",
						fontSize: 10,
						fontWeight: 600,
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						padding: "3px 10px",
						borderRadius: 100,
						background: currentPlan === "growth" ? "var(--accent-dim)" : "var(--bg3)",
						color: currentPlan === "growth" ? "var(--accent)" : "var(--text3)",
						border: `1px solid ${currentPlan === "growth" ? "var(--accent-mid)" : "var(--border2)"}`,
					}}
				>
					{plan.name}
				</span>
			</div>

			{/* Progress bar */}
			<div style={{ marginBottom: 10 }}>
				<div
					style={{
						height: 8,
						borderRadius: 100,
						background: "var(--bg3)",
						overflow: "hidden",
					}}
				>
					<div
						style={{
							height: "100%",
							width: `${Math.min(pct, 100)}%`,
							borderRadius: 100,
							background: barColor,
							transition: "width 0.5s ease",
						}}
					/>
				</div>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						marginTop: 6,
						fontFamily: "var(--mono)",
						fontSize: 11,
						color: "var(--text2)",
					}}
				>
					<span>
						{formatNumber(currentEvents)} / {formatNumber(plan.limit)}
					</span>
					<span
						style={{
							color: pct >= 90 ? "#ef4444" : pct >= 70 ? "var(--accent)" : "var(--text3)",
						}}
					>
						{pct.toFixed(0)}%
					</span>
				</div>
			</div>

			{/* Projected usage */}
			<div
				style={{
					fontSize: 12,
					color: willExceed ? "#ef4444" : "var(--text2)",
					fontFamily: "var(--mono)",
					lineHeight: 1.6,
					padding: "8px 12px",
					background: willExceed ? "rgba(239,68,68,.08)" : "var(--bg3)",
					borderRadius: 8,
					border: willExceed ? "1px solid rgba(239,68,68,.15)" : "1px solid var(--border)",
				}}
			>
				{willExceed ? (
					<>
						<span style={{ fontWeight: 600 }}>Projected: ~{formatNumber(projected)} events</span>
						<span style={{ display: "block", marginTop: 2, fontSize: 11 }}>
							You'll exceed your {plan.name} plan ({formatNumber(plan.limit)} events)
						</span>
						{currentPlan === "starter" && (
							<span
								style={{
									display: "block",
									marginTop: 4,
									fontSize: 11,
									color: "var(--accent)",
								}}
							>
								Consider upgrading to Growth ($12/mo for 100K events)
							</span>
						)}
					</>
				) : (
					<>
						<span style={{ color: "var(--text2)" }}>
							Projected: ~{formatNumber(projected)} events
						</span>
						<span style={{ color: "var(--green)", marginLeft: 6 }}>
							within your {plan.name} plan
						</span>
					</>
				)}
			</div>
		</div>
	);
}

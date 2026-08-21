import { createFileRoute, Link } from "@tanstack/react-router";
import type { RevenueBySource, SourceEntry, TimeSeriesPoint, TopPage } from "@revklik/shared";
import { DEMO_DASHBOARD } from "@/lib/demo-data";

export const Route = createFileRoute("/demo")({ component: DemoPage });

const ctaBtn: React.CSSProperties = {
	background: "var(--accent)",
	color: "var(--bg)",
	border: "none",
	padding: "8px 20px",
	borderRadius: 8,
	fontSize: 13,
	fontWeight: 600,
	cursor: "pointer",
	textDecoration: "none",
	display: "inline-block",
};

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
	return (
		<div
			style={{
				background: "var(--bg2)",
				border: "1px solid var(--border)",
				borderRadius: 12,
				padding: 20,
			}}
		>
			<div
				style={{
					fontSize: 12,
					color: "var(--text3)",
					marginBottom: 6,
					textTransform: "uppercase",
					letterSpacing: "0.05em",
				}}
			>
				{label}
			</div>
			<div
				style={{
					fontSize: 28,
					fontWeight: 700,
					color: "var(--text)",
					fontFamily: "var(--sans)",
				}}
			>
				{value}
			</div>
			{sub && <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>{sub}</div>}
		</div>
	);
}

function MiniBar({ value, max }: { value: number; max: number }) {
	const pct = max > 0 ? (value / max) * 100 : 0;
	return (
		<div
			style={{
				height: 6,
				borderRadius: 3,
				background: "var(--border)",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					height: "100%",
					width: `${pct}%`,
					borderRadius: 3,
					background: "var(--accent)",
					transition: "width 0.6s ease",
				}}
			/>
		</div>
	);
}

function DemoPage() {
	const db = DEMO_DASHBOARD;
	const maxVisitors = Math.max(...db.timeseries.map((t: TimeSeriesPoint) => t.visitors));
	const maxPageviews = Math.max(...db.topPages.map((p: TopPage) => p.pageviews));

	return (
		<div
			style={{
				minHeight: "100vh",
				background: "var(--bg)",
				color: "var(--text)",
			}}
		>
			{/* Top bar */}
			<div
				style={{
					borderBottom: "1px solid var(--border)",
					padding: "12px 24px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					flexWrap: "wrap",
					gap: 12,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<img
						src="/revklik.webp"
						alt="RevKlik"
						width={28}
						height={28}
						style={{ borderRadius: 6 }}
					/>
					<span
						style={{
							fontFamily: "var(--sans)",

							fontWeight: 500,
							fontSize: 16,
						}}
					>
						RevKlik
					</span>
					<span
						style={{
							fontSize: 11,
							background: "var(--accent)",
							color: "#fff",
							padding: "2px 8px",
							borderRadius: 4,
							fontWeight: 600,
						}}
					>
						DEMO
					</span>
				</div>
				<Link to="/register" search={{ ref: undefined }} style={ctaBtn}>
					Start Free Trial &mdash; $1/mo
				</Link>
			</div>

			<div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
				{/* CTA banner */}
				<div
					style={{
						background: "var(--accent)",
						borderRadius: 12,
						padding: "28px 32px",
						marginBottom: 24,
						color: "#fff",
					}}
				>
					<h2
						style={{
							fontFamily: "var(--sans)",

							fontWeight: 400,
							fontSize: 22,
							marginBottom: 8,
						}}
					>
						This is a live demo with sample data
					</h2>
					<p style={{ fontSize: 14, opacity: 0.9, marginBottom: 16 }}>
						Pageviews, heatmaps, session replay, and revenue attribution &mdash; all in one &lt;1KB
						script. No cookies required.
					</p>
					<Link
						to="/register"
						search={{ ref: undefined }}
						style={{
							...ctaBtn,
							background: "#fff",
							color: "var(--accent)",
							padding: "10px 24px",
							fontSize: 14,
						}}
					>
						Get Started for $1/mo
					</Link>
				</div>

				{/* Metrics */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
						gap: 12,
						marginBottom: 24,
					}}
				>
					<MetricCard
						label="Visitors"
						value={db.stats.visitors.toLocaleString()}
						sub="+12% vs last period"
					/>
					<MetricCard
						label="Pageviews"
						value={db.stats.pageviews.toLocaleString()}
						sub="+8% vs last period"
					/>
					<MetricCard
						label="Revenue"
						value={`$${db.stats.revenue.toLocaleString()}`}
						sub="+23% vs last period"
					/>
					<MetricCard
						label="Conversions"
						value={db.stats.conversions.toString()}
						sub={`Rate: ${((db.stats.conversions / db.stats.visitors) * 100).toFixed(1)}%`}
					/>
					<MetricCard label="Bounce Rate" value={`${db.stats.bounceRate}%`} />
					<MetricCard
						label="Avg. Duration"
						value={`${Math.floor(db.stats.avgDuration / 60)}m ${db.stats.avgDuration % 60}s`}
					/>
				</div>

				{/* Chart + Top pages */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "2fr 1fr",
						gap: 16,
						marginBottom: 24,
					}}
				>
					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 12,
							padding: 20,
						}}
					>
						<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
							Visitors Over Time
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "flex-end",
								gap: 8,
								height: 160,
							}}
						>
							{db.timeseries.map((t: TimeSeriesPoint) => (
								<div
									key={t.date}
									style={{
										flex: 1,
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										gap: 4,
									}}
								>
									<div style={{ fontSize: 10, color: "var(--text3)" }}>{t.visitors}</div>
									<div
										style={{
											width: "100%",
											borderRadius: 4,
											background: "var(--accent)",
											opacity: 0.8,
											height: `${(t.visitors / maxVisitors) * 140}px`,
											transition: "height 0.6s ease",
										}}
									/>
									<div style={{ fontSize: 9, color: "var(--text3)" }}>{t.date.slice(5)}</div>
								</div>
							))}
						</div>
					</div>

					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 12,
							padding: 20,
						}}
					>
						<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Top Pages</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							{db.topPages.slice(0, 6).map((p: TopPage) => (
								<div key={p.path}>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											fontSize: 12,
											marginBottom: 3,
										}}
									>
										<span
											style={{
												color: "var(--text2)",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												maxWidth: 120,
											}}
										>
											{p.path}
										</span>
										<span style={{ color: "var(--text3)" }}>{p.pageviews}</span>
									</div>
									<MiniBar value={p.pageviews} max={maxPageviews} />
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Sources + Revenue */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 16,
						marginBottom: 24,
					}}
				>
					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 12,
							padding: 20,
						}}
					>
						<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Traffic Sources</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{db.sources.map((s: SourceEntry) => (
								<div key={s.source} style={{ display: "flex", alignItems: "center", gap: 10 }}>
									<span style={{ fontSize: 12, width: 90, color: "var(--text2)" }}>{s.source}</span>
									<div style={{ flex: 1 }}>
										<MiniBar value={s.visitors} max={db.sources[0].visitors} />
									</div>
									<span
										style={{
											fontSize: 12,
											color: "var(--text3)",
											width: 40,
											textAlign: "right",
										}}
									>
										{s.percentage}%
									</span>
								</div>
							))}
						</div>
					</div>

					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 12,
							padding: 20,
						}}
					>
						<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Revenue by Source</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{db.revenueBySource.map((r: RevenueBySource) => (
								<div key={r.source} style={{ display: "flex", alignItems: "center", gap: 10 }}>
									<span style={{ fontSize: 12, width: 90, color: "var(--text2)" }}>{r.source}</span>
									<div style={{ flex: 1 }}>
										<MiniBar value={r.revenue} max={db.revenueBySource[0].revenue} />
									</div>
									<span
										style={{
											fontSize: 12,
											color: "var(--text3)",
											width: 60,
											textAlign: "right",
										}}
									>
										${r.revenue}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Features */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
						gap: 12,
						marginBottom: 24,
					}}
				>
					{[
						{
							title: "Cookieless Tracking",
							desc: "No cookie consent banners needed. Privacy-first by default.",
						},
						{
							title: "Heatmaps & Replay",
							desc: "See where users click and watch full session recordings.",
						},
						{
							title: "Revenue Attribution",
							desc: "Track revenue by source, campaign, and landing page.",
						},
						{
							title: "< 1KB Script",
							desc: "Lightweight tracking that won't slow down your site.",
						},
					].map((f) => (
						<div
							key={f.title}
							style={{
								background: "var(--bg2)",
								border: "1px solid var(--border)",
								borderRadius: 12,
								padding: 20,
							}}
						>
							<div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{f.title}</div>
							<div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.5 }}>{f.desc}</div>
						</div>
					))}
				</div>

				{/* Bottom CTA */}
				<div style={{ textAlign: "center", padding: "32px 0" }}>
					<Link
						to="/register"
						search={{ ref: undefined }}
						style={{
							...ctaBtn,
							padding: "14px 36px",
							fontSize: 16,
							borderRadius: 10,
						}}
					>
						Start Your Free Trial Now
					</Link>
					<p style={{ fontSize: 13, color: "var(--text3)", marginTop: 12 }}>
						No credit card required. Full access for 14 days.
					</p>
				</div>
			</div>
		</div>
	);
}

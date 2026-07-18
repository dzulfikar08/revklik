// Funnel visualization components

import { useState } from "react";
import type { FunnelStep, PageFunnel } from "shared";

const FUNNEL_COLORS = [
	"#d4882a",
	"#cd8227",
	"#c67c25",
	"#bf7623",
	"#b87021",
	"#b16a1f",
	"#aa641d",
	"#a35e1b",
	"#9c5819",
	"#955217",
	"#8e4c15",
	"#874613",
	"#804011",
	"#793a0f",
	"#72340d",
];

export function FunnelChartCustom({
	steps,
	conversionRate,
	pages,
	onCrossFilter,
}: {
	steps: FunnelStep[];
	conversionRate: number;
	pages: PageFunnel[];
	onCrossFilter?: (dimension: string, value: string) => void;
}) {
	const [hovered, setHovered] = useState<number | null>(null);
	const [selectedPage, setSelectedPage] = useState<string>("/");

	// Determine which data to show
	const activeFunnel = pages.find((p) => p.path === selectedPage);
	const fallback = { steps, conversionRate, path: "/", totalVisitors: 0 };
	const active = activeFunnel ?? pages[0] ?? fallback;
	const activeSteps = active.steps;
	const activeConv = active.conversionRate;
	const activeTitle = active.path;

	if (steps.length === 0 && pages.length === 0) {
		return (
			<div className="funnel-card">
				<div className="funnel-title">LP Scroll Funnel</div>
				<div
					style={{
						padding: "32px 0",
						color: "var(--text3)",
						fontSize: 13,
						textAlign: "center",
					}}
				>
					No scroll data yet — add{" "}
					<code
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11,
							background: "var(--bg3)",
							padding: "2px 6px",
							borderRadius: 4,
						}}
					>
						data-section
					</code>{" "}
					attributes to your page sections
				</div>
			</div>
		);
	}

	const H = 200;
	const isNarrow = typeof window !== "undefined" && window.innerWidth < 500;
	const stepW = isNarrow
		? activeSteps.length > 6
			? 48
			: 60
		: activeSteps.length > 6
			? 80
			: 120;
	const gap = 4;
	const maxVal = activeSteps[0]?.visitors || 1;
	const totalW = activeSteps.length * (stepW + gap);
	const cy = H / 2;

	const sections = activeSteps.map((s, i) => {
		const ratio = s.visitors / maxVal;
		const nextRatio =
			i < activeSteps.length - 1
				? activeSteps[i + 1]?.visitors / maxVal
				: ratio * 0.6;
		const x = i * (stepW + gap);
		const halfH = (H / 2) * ratio;
		const nextHalfH = (H / 2) * nextRatio;
		const curve = stepW * 0.4;
		const d = [
			`M ${x} ${cy - halfH}`,
			`C ${x + curve} ${cy - halfH}, ${x + stepW - curve} ${cy - nextHalfH}, ${x + stepW} ${cy - nextHalfH}`,
			`L ${x + stepW} ${cy + nextHalfH}`,
			`C ${x + stepW - curve} ${cy + nextHalfH}, ${x + curve} ${cy + halfH}, ${x} ${cy + halfH}`,
			"Z",
		].join(" ");
		return { d, x, step: s, color: FUNNEL_COLORS[i % FUNNEL_COLORS.length] };
	});

	const hSec = hovered !== null ? sections[hovered] : null;

	return (
		<div
			className="funnel-card"
			style={{ padding: "16px 16px 4px", position: "relative" }}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					marginBottom: 8,
				}}
			>
				<div>
					<span className="funnel-title">LP Scroll Funnel</span>
					<span className="funnel-subtitle">{activeSteps.length} steps</span>
				</div>
				<div style={{ textAlign: "right" }}>
					<div
						style={{
							fontFamily: "var(--mono)",
							fontSize: 20,
							fontWeight: 600,
							color: "var(--green)",
						}}
					>
						{activeConv}%
					</div>
					<div
						style={{
							fontFamily: "var(--mono)",
							fontSize: 10,
							color: "var(--text3)",
							textTransform: "uppercase",
							letterSpacing: "0.06em",
						}}
					>
						Conversion
					</div>
				</div>
			</div>

			{/* Page selector */}
			{pages.length > 0 && (
				<div className="scroll-x" style={{ marginBottom: 8 }}>
					<div style={{ display: "inline-flex", gap: 2 }}>
						{pages.map((p) => (
							<button
								type="button"
								key={p.path}
								onClick={() => {
									setSelectedPage(p.path);
									onCrossFilter?.("path", p.path);
								}}
								style={{
									fontSize: 10,
									padding: "3px 8px",
									borderRadius: 4,
									border: "none",
									cursor: "pointer",
									fontFamily: "var(--mono)",
									whiteSpace: "nowrap",
									background:
										selectedPage === p.path
											? "var(--accent-dim)"
											: "transparent",
									color:
										selectedPage === p.path ? "var(--accent)" : "var(--text3)",
								}}
							>
								{p.path} ({p.totalVisitors})
							</button>
						))}
					</div>
				</div>
			)}

			<div
				style={{
					fontFamily: "var(--mono)",
					fontSize: 10,
					color: "var(--text4)",
					marginBottom: 4,
				}}
			>
				{activeTitle}
			</div>

			<div className={isNarrow ? "scroll-x" : undefined}>
				<svg
					viewBox={`0 0 ${totalW} ${H}`}
					role="img"
					aria-label={`LP scroll funnel chart, ${activeSteps.length} steps, ${activeConv}% conversion`}
					style={{
						width: isNarrow ? totalW : "100%",
						height: "auto",
						display: "block",
						minWidth: totalW,
					}}
				>
					<defs>
						{sections.map((sec, i) => (
							<linearGradient
								key={sec.step.section}
								id={`fg${i}`}
								x1="0"
								y1="0"
								x2="0"
								y2="1"
							>
								<stop offset="0%" stopColor={sec.color} stopOpacity={0.85} />
								<stop offset="50%" stopColor={sec.color} stopOpacity={1} />
								<stop offset="100%" stopColor={sec.color} stopOpacity={0.85} />
							</linearGradient>
						))}
					</defs>
					{sections.map((sec, i) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: SVG <g> hover-only for tooltip; not an interactive control
						<g
							key={sec.step.section}
							onMouseEnter={() => setHovered(i)}
							onMouseLeave={() => setHovered(null)}
							style={{ cursor: "pointer" }}
						>
							<path
								d={sec.d}
								fill={hovered === i ? sec.color : `url(#fg${i})`}
								stroke={hovered === i ? "#fff" : "none"}
								strokeWidth={hovered === i ? 1.5 : 0}
								style={{ transition: "fill 0.15s, stroke 0.15s" }}
							/>
							<text
								x={sec.x + stepW / 2}
								y={cy - 6}
								textAnchor="middle"
								dominantBaseline="central"
								style={{
									fill: "#fff",
									fontFamily: "var(--mono)",
									fontSize: stepW > 100 ? 10 : 8,
									fontWeight: 600,
									pointerEvents: "none",
								}}
							>
								{sec.step.section}
							</text>
							<text
								x={sec.x + stepW / 2}
								y={cy + 10}
								textAnchor="middle"
								dominantBaseline="central"
								style={{
									fill: "rgba(255,255,255,.7)",
									fontFamily: "var(--mono)",
									fontSize: stepW > 100 ? 11 : 9,
									fontWeight: 700,
									pointerEvents: "none",
								}}
							>
								{sec.step.visitors.toLocaleString()}
							</text>
						</g>
					))}
				</svg>
			</div>
			{hSec && (
				<div
					style={{
						position: "absolute",
						bottom: 36,
						left: "50%",
						transform: "translateX(-50%)",
						background: "var(--bg3)",
						border: "1px solid var(--border2)",
						borderRadius: 8,
						padding: "8px 14px",
						fontSize: 12,
						fontFamily: "var(--mono)",
						color: "var(--text)",
						boxShadow: "0 8px 24px rgba(0,0,0,.5)",
						pointerEvents: "none",
						zIndex: 10,
						display: "flex",
						gap: 16,
						alignItems: "center",
						whiteSpace: "nowrap",
					}}
				>
					<span style={{ color: hSec.color, fontWeight: 700 }}>
						{hSec.step.section}
					</span>
					<span>{hSec.step.visitors.toLocaleString()} visitors</span>
					<span style={{ color: "var(--text3)" }}>{hSec.step.percentage}%</span>
					{hSec.step.dropoff > 0 && (
						<span style={{ color: "#f87171" }}>
							-{hSec.step.dropoff}% dropoff
						</span>
					)}
				</div>
			)}
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: "8px 16px",
					padding: "8px 0 4px",
					fontSize: 11,
					color: "var(--text3)",
				}}
			>
				{activeSteps.map((s, i) => (
					<span
						key={s.section}
						style={{ display: "flex", alignItems: "center", gap: 4 }}
					>
						<span
							style={{
								width: 8,
								height: 8,
								borderRadius: 2,
								background: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
							}}
						/>
						<span>{s.section}</span>
					</span>
				))}
			</div>
		</div>
	);
}

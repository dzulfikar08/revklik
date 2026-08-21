// Customer journey components

import type { VisitorJourney } from "@revklik/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	avatarUrl,
	BrowserIcon,
	countryFlag,
	DeviceIcon,
	nameFromVisitorId,
	OSIcon,
} from "./icons";
import { formatTime } from "./metric-cards";

export function parseProps(raw: string | null): Record<string, string> {
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

export function sessionDuration(j: VisitorJourney): string {
	if (j.steps.length < 2) return "0s";
	const start = new Date(j.steps[0].timestamp).getTime();
	const end = new Date(j.steps[j.steps.length - 1].timestamp).getTime();
	const d = end - start;
	if (d < 60000) return `${Math.round(d / 1000)}s`;
	if (d < 3600000) return `${Math.round(d / 60000)}m ${Math.round((d % 60000) / 1000)}s`;
	return `${Math.round(d / 3600000)}h`;
}

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent>{text}</TooltipContent>
		</Tooltip>
	);
}

function StepIcon({ type }: { type: string }) {
	if (type === "pageview")
		return <span style={{ color: "var(--accent)", fontSize: 13 }}>&#9670;</span>;
	if (type === "conversion")
		return <span style={{ color: "var(--green)", fontSize: 13 }}>&#9733;</span>;
	return <span style={{ color: "var(--text3)", fontSize: 13 }}>&#9679;</span>;
}

function StepLabel({ step }: { step: VisitorJourney["steps"][number] }) {
	const props = parseProps(step.props);
	if (step.event_type === "pageview") {
		return <span style={{ color: "var(--text)" }}>{step.path}</span>;
	}
	if (step.event_type === "custom" && step.name === "scroll") {
		const depth = props.depth ? `${props.depth}%` : "";
		const section = props.section ? props.section : "";
		return (
			<span style={{ color: "var(--text2)" }}>
				Scrolled to {depth}
				{section ? ` — ${section}` : ""}
			</span>
		);
	}
	if (step.event_type === "custom" && step.name === "scroll_section") {
		const section = props.section ?? "section";
		const depth = props.depth ? ` (${props.depth}%)` : "";
		return (
			<span style={{ color: "var(--text2)" }}>
				Read section: {section}
				{depth}
			</span>
		);
	}
	if (step.event_type === "custom" && step.name === "click") {
		const label = props.label ?? "unknown";
		const tag = props.tag ?? "";
		return (
			<span style={{ color: "var(--text)" }}>
				Clicked <span style={{ color: "var(--accent)", fontWeight: 500 }}>"{label}"</span>{" "}
				<span style={{ color: "var(--text3)", fontSize: 11 }}>&lt;{tag}&gt;</span>
			</span>
		);
	}
	if (step.event_type === "custom" && step.name === "heartbeat") {
		const secs = props.seconds ? `${props.seconds}s` : "";
		return <span style={{ color: "var(--text3)" }}>Active {secs}</span>;
	}
	if (step.event_type === "conversion") {
		return (
			<span style={{ color: "var(--green)", fontWeight: 600 }}>
				Conversion: {step.name} {step.revenue ? `$${step.revenue}` : ""}
			</span>
		);
	}
	return <span style={{ color: "var(--text2)" }}>{step.name || step.event_type}</span>;
}

export function JourneyTimeline({ journey }: { journey: VisitorJourney }) {
	const steps = journey.steps;
	return (
		<div className="journey-timeline">
			{steps.map((step, i) => {
				const prev = i > 0 ? steps[i - 1] : null;
				const gap = prev
					? new Date(step.timestamp).getTime() - new Date(prev.timestamp).getTime()
					: 0;
				const showGap = gap > 5 * 60 * 1000;
				return (
					<div key={`${step.timestamp}-${step.event_type}`}>
						{showGap && (
							<div className="timeline-gap">
								<span className="timeline-gap-line" />
								<span className="timeline-gap-label">
									{gap > 3600000
										? `${Math.round(gap / 3600000)}h gap`
										: `${Math.round(gap / 60000)}m gap`}
								</span>
								<span className="timeline-gap-line" />
							</div>
						)}
						<div className="timeline-row">
							<div className="timeline-left">
								<StepIcon type={step.event_type} />
								<span className="timeline-time">{formatTime(step.timestamp)}</span>
							</div>
							<div
								className="timeline-content"
								title={`${formatTime(step.timestamp)} — ${step.event_type === "pageview" ? step.path : step.name || step.event_type}`}
							>
								<StepLabel step={step} />
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

export function JourneyCard({
	journey,
	selected,
	onClick,
}: {
	journey: VisitorJourney;
	selected: boolean;
	onClick: () => void;
}) {
	const displayName = journey.visitor_name || nameFromVisitorId(journey.visitor_id);
	const hasRevenue = journey.total_revenue > 0;
	const dateStr = new Date(journey.started_at).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
	});
	const timeStr = formatTime(journey.started_at);

	return (
		<div className={`journey-card ${selected ? "selected" : ""}`}>
			<button type="button" className="journey-main" onClick={onClick}>
				<img
					src={avatarUrl(displayName)}
					alt=""
					style={{
						width: 24,
						height: 24,
						borderRadius: "50%",
						background: "var(--bg3)",
						flexShrink: 0,
					}}
				/>
				<Tip text={displayName}>
					<span className="journey-name">{displayName}</span>
				</Tip>
				{journey.country && (
					<Tip text={[journey.city, journey.region, journey.country].filter(Boolean).join(", ")}>
						<span className="journey-meta">
							{countryFlag(journey.country)}{" "}
							{[journey.city, journey.region].filter(Boolean).join(", ")}
						</span>
					</Tip>
				)}
				{(journey.device_type || journey.os || journey.browser) && (
					<Tip
						text={[journey.device_type, journey.os, journey.browser].filter(Boolean).join(" · ")}
					>
						<span
							className="journey-meta"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								flexShrink: 0,
							}}
						>
							{journey.device_type ? (
								<>
									<DeviceIcon device={journey.device_type} />
									{journey.device_type}
								</>
							) : null}
							{journey.os && (
								<>
									<span style={{ color: "var(--text4)" }}>·</span>
									<OSIcon os={journey.os} />
									{journey.os}
								</>
							)}
							{journey.browser && (
								<>
									<span style={{ color: "var(--text4)" }}>·</span>
									<BrowserIcon browser={journey.browser} />
									{journey.browser}
								</>
							)}
						</span>
					</Tip>
				)}
				{journey.utm_source && (
					<Tip text={`Source: ${journey.utm_source}`}>
						<span className="journey-meta" style={{ color: "var(--accent)" }}>
							via {journey.utm_source}
						</span>
					</Tip>
				)}
				{hasRevenue && (
					<Tip text={`Revenue: $${journey.total_revenue}`}>
						<span className="journey-revenue">${journey.total_revenue}</span>
					</Tip>
				)}
				<Tip text={`${dateStr} ${timeStr}`}>
					<span className="journey-meta">
						{dateStr} {timeStr}
					</span>
				</Tip>
			</button>
		</div>
	);
}

export { Tip };

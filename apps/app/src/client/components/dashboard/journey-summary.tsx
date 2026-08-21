import { useMemo, useState } from "react";
import type { JourneySortKey, VisitorJourney } from "@revklik/shared";
import {
	countryFlag,
	DeviceIcon,
	nameFromVisitorId,
	sourceLabel,
} from "./icons";
import { formatTime } from "./metric-cards";

const SORT_KEYS: { key: JourneySortKey; label: string }[] = [
	{ key: "steps", label: "Steps" },
	{ key: "revenue", label: "Revenue" },
	{ key: "source", label: "Source" },
	{ key: "device", label: "Device" },
	{ key: "date", label: "Date" },
];

export function JourneySummaryTable({
	journeys,
	selectedJourney,
	setSelectedJourney,
}: {
	journeys: VisitorJourney[];
	selectedJourney: VisitorJourney | null;
	setSelectedJourney: (j: VisitorJourney) => void;
}) {
	const [sortKey, setSortKey] = useState<JourneySortKey>("steps");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

	const rows = useMemo(
		() =>
			journeys.map((j) => ({
				journey: j,
				visitor_name: j.visitor_name || nameFromVisitorId(j.visitor_id),
				steps_count: j.steps.length,
				total_revenue: j.total_revenue,
				source: j.utm_source || j.referrer || "direct",
				device_type: j.device_type || "unknown",
				country: j.country,
				started_at: j.started_at,
				is_identified: j.is_identified,
			})),
		[journeys],
	);

	const sorted = useMemo(() => {
		const copy = [...rows];
		copy.sort((a, b) => {
			let cmp = 0;
			switch (sortKey) {
				case "date":
					cmp = a.started_at.localeCompare(b.started_at);
					break;
				case "steps":
					cmp = a.steps_count - b.steps_count;
					break;
				case "revenue":
					cmp = a.total_revenue - b.total_revenue;
					break;
				case "source":
					cmp = a.source.localeCompare(b.source);
					break;
				case "device":
					cmp = a.device_type.localeCompare(b.device_type);
					break;
			}
			return sortDir === "desc" ? -cmp : cmp;
		});
		return copy;
	}, [rows, sortKey, sortDir]);

	const toggleSort = (key: JourneySortKey) => {
		if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
		else {
			setSortKey(key);
			setSortDir("desc");
		}
	};

	return (
		<div className="journey-summary-table">
			<table className="data-table">
				<thead>
					<tr>
						<th style={{ textAlign: "left" }}>Visitor</th>
						{SORT_KEYS.map((sk) => (
							<th
								key={sk.key}
								onClick={() => toggleSort(sk.key)}
								className={`journey-summary-th ${sk.key === "device" ? "journey-summary-hide-mobile" : ""}`}
							>
								{sk.label}
								{sortKey === sk.key
									? sortDir === "desc"
										? " \u25BC"
										: " \u25B2"
									: ""}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{sorted.map((r) => (
						<tr
							key={r.journey.session_id}
							className={`journey-summary-row ${selectedJourney?.session_id === r.journey.session_id ? "selected" : ""}`}
							onClick={() => setSelectedJourney(r.journey)}
						>
							<td style={{ textAlign: "left" }}>
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
									}}
								>
									{r.country && (
										<span style={{ fontSize: 11 }}>
											{countryFlag(r.country)}
										</span>
									)}
									<span
										style={{
											fontWeight: r.is_identified ? 600 : 400,
											color: r.is_identified ? "var(--purple)" : "var(--text)",
											fontSize: 11,
											maxWidth: 120,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											display: "inline-block",
										}}
									>
										{r.visitor_name}
									</span>
								</span>
							</td>
							<td
								style={{
									fontWeight: 600,
									color: r.steps_count >= 5 ? "var(--accent)" : "var(--text)",
								}}
							>
								{r.steps_count}
							</td>
							<td>
								<span style={{ fontSize: 11, color: "var(--text2)" }}>
									{sourceLabel(r.source)}
								</span>
							</td>
							<td className="journey-summary-hide-mobile">
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 3,
										fontSize: 11,
									}}
								>
									<DeviceIcon device={r.device_type} />
									{r.device_type}
								</span>
							</td>
							<td
								className={
									r.total_revenue > 0
										? "journey-summary-revenue"
										: "journey-summary-revenue zero"
								}
							>
								{r.total_revenue > 0 ? `$${r.total_revenue.toFixed(2)}` : "-"}
							</td>
							<td
								style={{
									fontSize: 10,
									color: "var(--text3)",
									whiteSpace: "nowrap",
								}}
							>
								{new Date(r.started_at).toLocaleDateString("en-GB", {
									day: "numeric",
									month: "short",
								})}{" "}
								{formatTime(r.started_at)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

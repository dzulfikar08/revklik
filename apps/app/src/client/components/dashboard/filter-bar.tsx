import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Filter } from "@revklik/shared";
import { fetchSegments, getActiveSiteId } from "@/lib/api";
import {
	encodeFilterString,
	FILTER_DIMENSIONS,
	FILTER_OPERATORS,
	formatFilterLabel,
	parseFilterString,
	toggleFilter,
} from "@/lib/filters";

export function FilterBar({
	filters,
	onFiltersChange,
}: {
	filters: string;
	onFiltersChange: (s: string) => void;
}) {
	const rules = parseFilterString(filters);
	const [showBuilder, setShowBuilder] = useState(false);
	const [newDim, setNewDim] = useState("path");
	const [newOp, setNewOp] = useState("is");
	const [newVal, setNewVal] = useState("");

	// Saved segments (Settings → Segments) apply as one-click filter presets.
	const siteId = getActiveSiteId() ?? "";
	const { data: segments } = useQuery({
		queryKey: ["segments", siteId],
		queryFn: () => fetchSegments(siteId),
		enabled: !!siteId,
	});

	const applySegment = (id: string) => {
		const seg = segments?.find((s) => s.id === id);
		if (!seg) return;
		try {
			const parsed = JSON.parse(seg.filters) as Filter[];
			if (Array.isArray(parsed)) onFiltersChange(encodeFilterString(parsed));
		} catch {
			/* malformed segment — ignore */
		}
	};

	const noValue = newOp === "exists" || newOp === "not_exists";

	const handleAdd = () => {
		const rule: Filter = {
			dimension: newDim,
			operator: newOp as Filter["operator"],
			value: noValue ? "" : newVal,
		};
		const updated = toggleFilter(rules, rule);
		onFiltersChange(encodeFilterString(updated));
		setNewVal("");
		setShowBuilder(false);
	};

	const handleRemove = (rule: Filter) => {
		const updated = rules.filter(
			(r) =>
				!(r.dimension === rule.dimension && r.operator === rule.operator && r.value === rule.value),
		);
		onFiltersChange(encodeFilterString(updated));
	};

	const handleClear = () => {
		onFiltersChange("");
	};

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "6px 20px",
				borderBottom: "1px solid var(--border)",
				background: "var(--bg2)",
				flexWrap: "wrap",
			}}
		>
			<span
				style={{
					fontSize: 10,
					fontFamily: "var(--mono)",
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.08em",
					color: "var(--text3)",
				}}
			>
				{rules.length > 0 ? `${rules.length} filter${rules.length > 1 ? "s" : ""}` : "Filter"}
			</span>

			{rules.map((r) => (
				<button
					type="button"
					key={`${r.dimension}:${r.operator}:${r.value}`}
					className="btn-pill"
					style={{
						fontSize: 11,
						padding: "3px 10px",
						display: "flex",
						alignItems: "center",
						gap: 4,
						background: "var(--accent-dim)",
						color: "var(--accent)",
						border: "1px solid var(--accent-mid)",
					}}
					onClick={() => handleRemove(r)}
				>
					{formatFilterLabel(r)} <span style={{ opacity: 0.6 }}>&#10005;</span>
				</button>
			))}

			{rules.length > 0 && (
				<button
					type="button"
					className="btn-pill"
					style={{ fontSize: 10, padding: "3px 8px", color: "var(--text3)" }}
					onClick={handleClear}
				>
					Clear all
				</button>
			)}

			<div
				style={{
					marginLeft: "auto",
					display: "flex",
					gap: 6,
					alignItems: "center",
				}}
			>
				{segments && segments.length > 0 && (
					<select
						value=""
						onChange={(e) => applySegment(e.target.value)}
						style={selectStyle}
						title="Apply a saved segment"
						aria-label="Apply a saved segment"
					>
						<option value="">Saved views</option>
						{segments.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
				)}
				{!showBuilder ? (
					<button
						type="button"
						className="btn-pill"
						style={{ fontSize: 11, padding: "4px 10px", color: "var(--text2)" }}
						onClick={() => setShowBuilder(true)}
					>
						+ Add filter
					</button>
				) : (
					<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
						<select value={newDim} onChange={(e) => setNewDim(e.target.value)} style={selectStyle}>
							{FILTER_DIMENSIONS.map((d) => (
								<option key={d.value} value={d.value}>
									{d.label}
								</option>
							))}
						</select>
						<select value={newOp} onChange={(e) => setNewOp(e.target.value)} style={selectStyle}>
							{FILTER_OPERATORS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
						{!noValue && (
							<input
								value={newVal}
								onChange={(e) => setNewVal(e.target.value)}
								placeholder="Value"
								style={{ ...inputStyle, width: 120 }}
								onKeyDown={(e) => e.key === "Enter" && handleAdd()}
							/>
						)}
						<button
							type="button"
							className="btn-accent"
							style={{ fontSize: 11, padding: "4px 10px" }}
							onClick={handleAdd}
							disabled={!noValue && !newVal}
						>
							Apply
						</button>
						<button
							type="button"
							className="btn-pill"
							style={{
								fontSize: 11,
								padding: "4px 10px",
								color: "var(--text3)",
							}}
							onClick={() => setShowBuilder(false)}
						>
							Cancel
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

const selectStyle: React.CSSProperties = {
	fontSize: 11,
	padding: "4px 8px",
	borderRadius: 6,
	border: "1px solid var(--border2)",
	background: "var(--bg3)",
	color: "var(--text)",
	fontFamily: "var(--mono)",
};

const inputStyle: React.CSSProperties = {
	fontSize: 11,
	padding: "4px 8px",
	borderRadius: 6,
	border: "1px solid var(--border2)",
	background: "var(--bg3)",
	color: "var(--text)",
	fontFamily: "var(--mono)",
	outline: "none",
};

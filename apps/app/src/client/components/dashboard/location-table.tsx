import { useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { countryFlag } from "./icons";

type LocationTab = "country" | "region" | "city";
type SortDir = "asc" | "desc";

export function LocationTable({
	geoData,
	onCrossFilter,
}: {
	geoData: {
		country: string | null;
		region: string | null;
		city: string | null;
		visitors: number;
	}[];
	onCrossFilter: (dimension: string, value: string) => void;
}) {
	const [tab, setTab] = useState<LocationTab>("country");
	const [sortKey, setSortKey] = useState<"name" | "visitors">("visitors");
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	const aggregated = useMemo(() => {
		const key = tab === "country" ? "country" : tab === "region" ? "region" : "city";
		const map = new Map<string, { name: string; visitors: number; country: string | null }>();
		for (const g of geoData) {
			const val = g[key] ?? "Unknown";
			const existing = map.get(val);
			if (existing) {
				existing.visitors += Number(g.visitors);
			} else {
				map.set(val, {
					name: val,
					visitors: Number(g.visitors),
					country: g.country ?? null,
				});
			}
		}
		const rows = [...map.values()];
		rows.sort((a, b) => {
			if (sortKey === "visitors")
				return sortDir === "desc" ? b.visitors - a.visitors : a.visitors - b.visitors;
			return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
		});
		return rows;
	}, [geoData, tab, sortKey, sortDir]);

	const toggleSort = (key: "name" | "visitors") => {
		if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
		else {
			setSortKey(key);
			setSortDir("desc");
		}
	};

	const sortArrow = (key: "name" | "visitors") =>
		sortKey === key ? (sortDir === "desc" ? " \u2193" : " \u2191") : "";

	const handleRowClick = (row: { name: string; country: string | null }) => {
		const dimension = tab === "country" ? "country" : tab === "region" ? "region" : "city";
		onCrossFilter(dimension, row.name);
	};

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
					{t("table.locations")}
				</span>
				<div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
					{(["country", "region", "city"] as LocationTab[]).map((t2) => (
						<button
							type="button"
							key={t2}
							onClick={() => setTab(t2)}
							style={{
								fontSize: 10,
								padding: "2px 8px",
								borderRadius: 4,
								border: "none",
								cursor: "pointer",
								fontFamily: "var(--mono)",
								textTransform: "capitalize",
								background: tab === t2 ? "var(--accent-dim)" : "transparent",
								color: tab === t2 ? "var(--accent)" : "var(--text3)",
							}}
						>
							{t2}
						</button>
					))}
				</div>
			</div>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<table className="data-table">
					<thead>
						<tr>
							<th
								style={{ cursor: "pointer", userSelect: "none" }}
								onClick={() => toggleSort("name")}
							>
								{tab === "country"
									? t("table.country")
									: tab === "region"
										? t("table.region")
										: t("table.city")}
								{sortArrow("name")}
							</th>
							{tab !== "country" && <th>{t("table.country")}</th>}
							<th
								style={{
									cursor: "pointer",
									userSelect: "none",
									textAlign: "right",
								}}
								onClick={() => toggleSort("visitors")}
							>
								{t("table.visitors")}
								{sortArrow("visitors")}
							</th>
						</tr>
					</thead>
					<tbody>
						{aggregated.map((row) => (
							<tr key={row.name} style={{ cursor: "pointer" }} onClick={() => handleRowClick(row)}>
								<td style={{ fontSize: 13 }}>
									{tab === "country" ? (
										<>
											{countryFlag(row.name)} {row.name}
										</>
									) : (
										row.name
									)}
								</td>
								{tab !== "country" && (
									<td style={{ fontSize: 13 }}>
										{countryFlag(row.country)} {row.country ?? "\u2014"}
									</td>
								)}
								<td
									style={{
										textAlign: "right",
										fontFamily: "var(--mono)",
										fontSize: 12,
									}}
								>
									{row.visitors.toLocaleString()}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

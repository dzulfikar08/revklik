// Reusable data table component

import { t } from "@/lib/i18n";

export function DataTable({
	title,
	rows,
	columns,
	onRowClick,
}: {
	title: string;
	rows: Record<string, string | number>[];
	columns: {
		key: string;
		label: string;
		align?: "left" | "right";
		mono?: boolean;
	}[];
	onRowClick?: (row: Record<string, string | number>) => void;
}) {
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
			<div className="data-table-title">{title}</div>
			{rows.length === 0 ? (
				<div
					style={{
						padding: 16,
						color: "var(--text3)",
						fontSize: 12,
						textAlign: "center",
					}}
				>
					{t("common.no_data")}
				</div>
			) : (
				<div className="scroll-x" style={{ flex: 1, overflowY: "auto" }}>
					<table className="data-table">
						<thead>
							<tr>
								{columns.map((col) => (
									<th key={col.key} style={{ textAlign: col.align || "left" }}>
										{col.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr
									key={JSON.stringify(row)}
									onClick={onRowClick ? () => onRowClick(row) : undefined}
									style={onRowClick ? { cursor: "pointer" } : undefined}
								>
									{columns.map((col) => (
										<td
											key={col.key}
											style={{
												textAlign: col.align || "left",
												fontFamily: col.mono ? "var(--mono)" : "inherit",
												fontSize: col.mono ? 12 : 13,
											}}
										>
											{row[col.key] ?? "\u2014"}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

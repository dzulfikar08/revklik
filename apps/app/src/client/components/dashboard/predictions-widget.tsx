// Revenue predictions widget

import { useQuery } from "@tanstack/react-query";
import type { RevenuePrediction } from "@revklik/shared";
import { fetchPredictions, refreshPredictions } from "@/lib/api";

export function PredictionsWidget({ siteId }: { siteId: string }) {
	const { data, isLoading, refetch, isRefetching } = useQuery({
		queryKey: ["predictions", siteId],
		queryFn: () => fetchPredictions(siteId),
		enabled: !!siteId,
		staleTime: 60 * 60 * 1000,
	});

	const top5 = (data?.predictions ?? [])
		.sort((a, b) => b.conversion_probability - a.conversion_probability)
		.slice(0, 5);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				padding: "10px 14px",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 8,
				}}
			>
				<span className="data-table-title" style={{ marginBottom: 0 }}>
					Revenue Predictions
				</span>
				<button type="button"
					onClick={() => refreshPredictions(siteId).then(() => refetch())}
					disabled={isRefetching}
					style={{
						fontSize: 10,
						padding: "3px 10px",
						borderRadius: 4,
						border: "1px solid var(--border)",
						cursor: isRefetching ? "wait" : "pointer",
						background: "transparent",
						color: "var(--text3)",
						fontFamily: "var(--mono)",
					}}
				>
					{isRefetching ? "Loading..." : "Refresh"}
				</button>
			</div>
			{isLoading ? (
				<div
					style={{
						flex: 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<div className="spinner" />
				</div>
			) : top5.length === 0 ? (
				<div
					style={{
						flex: 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "var(--text3)",
						fontSize: 12,
					}}
				>
					No visitor data yet
				</div>
			) : (
				<div style={{ flex: 1, overflowY: "auto" }}>
					<table className="data-table">
						<thead>
							<tr>
								<th>Visitor</th>
								<th style={{ textAlign: "right" }}>Score</th>
								<th style={{ textAlign: "right" }}>Predicted LTV</th>
							</tr>
						</thead>
						<tbody>
							{top5.map((p: RevenuePrediction) => (
								<tr key={p.visitor_id}>
									<td style={{ fontSize: 12, fontFamily: "var(--mono)" }}>
										{p.visitor_id.length > 12
											? `${p.visitor_id.slice(0, 12)}...`
											: p.visitor_id}
									</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											fontSize: 12,
										}}
									>
										<span
											style={{
												color:
													p.conversion_probability >= 70
														? "var(--green)"
														: p.conversion_probability >= 40
															? "var(--accent)"
															: "var(--text3)",
												fontWeight: 600,
											}}
										>
											{p.conversion_probability}%
										</span>
									</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											fontSize: 12,
										}}
									>
										${p.predicted_revenue.toFixed(2)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{data?.model_version && (
						<div
							style={{
								marginTop: 6,
								fontSize: 10,
								color: "var(--text3)",
								fontFamily: "var(--mono)",
							}}
						>
							Model: {data.model_version} &middot;{" "}
							{data.generated_at
								? new Date(data.generated_at).toLocaleTimeString()
								: ""}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

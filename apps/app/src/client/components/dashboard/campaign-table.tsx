import { useQuery } from "@tanstack/react-query";
import type { CampaignPerformance } from "@revklik/shared";
import { fetchCampaigns } from "@/lib/api";

export function CampaignTable({
	siteId,
	range,
	filters,
	onCrossFilter,
}: {
	siteId: string;
	range: string;
	filters?: string;
	onCrossFilter?: (dim: string, val: string) => void;
}) {
	const { data: campaigns, isLoading } = useQuery({
		queryKey: ["campaigns", siteId, range, filters],
		queryFn: () => fetchCampaigns(siteId, range, filters),
		staleTime: 5 * 60 * 1000,
	});

	if (isLoading)
		return (
			<div
				style={{
					padding: 20,
					textAlign: "center",
					color: "var(--text3)",
					fontSize: 13,
				}}
			>
				Loading campaigns...
			</div>
		);
	if (!campaigns?.length)
		return (
			<div
				style={{
					padding: 20,
					textAlign: "center",
					color: "var(--text3)",
					fontSize: 13,
				}}
			>
				No campaign data yet
			</div>
		);

	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString());

	return (
		<div style={{ overflowX: "auto" }}>
			<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
				<thead>
					<tr style={{ borderBottom: "1px solid var(--border)" }}>
						<th
							style={{
								textAlign: "left",
								padding: "8px 6px",
								color: "var(--text3)",
								fontWeight: 500,
							}}
						>
							Campaign
						</th>
						<th
							style={{
								textAlign: "left",
								padding: "8px 6px",
								color: "var(--text3)",
								fontWeight: 500,
							}}
						>
							Source
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "8px 6px",
								color: "var(--text3)",
								fontWeight: 500,
							}}
						>
							Visitors
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "8px 6px",
								color: "var(--text3)",
								fontWeight: 500,
							}}
						>
							Conversions
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "8px 6px",
								color: "var(--text3)",
								fontWeight: 500,
							}}
						>
							Revenue
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "8px 6px",
								color: "var(--text3)",
								fontWeight: 500,
							}}
						>
							Conv. Rate
						</th>
					</tr>
				</thead>
				<tbody>
					{campaigns.map((c: CampaignPerformance) => (
						<tr
							key={c.utm_campaign}
							onClick={() => onCrossFilter?.("utm_campaign", c.utm_campaign)}
							style={{
								borderBottom: "1px solid var(--border)",
								cursor: onCrossFilter ? "pointer" : "default",
							}}
							onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
							onMouseLeave={(e) => (e.currentTarget.style.background = "")}
						>
							<td
								style={{
									padding: "8px 6px",
									color: "var(--text)",
									maxWidth: 140,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{c.utm_campaign}
							</td>
							<td style={{ padding: "8px 6px", color: "var(--text2)" }}>{c.utm_source}</td>
							<td
								style={{
									padding: "8px 6px",
									textAlign: "right",
									color: "var(--text2)",
								}}
							>
								{fmt(c.visitors)}
							</td>
							<td
								style={{
									padding: "8px 6px",
									textAlign: "right",
									color: "var(--text2)",
								}}
							>
								{c.conversions}
							</td>
							<td
								style={{
									padding: "8px 6px",
									textAlign: "right",
									color: "var(--green)",
									fontWeight: 500,
								}}
							>
								${c.revenue.toFixed(2)}
							</td>
							<td
								style={{
									padding: "8px 6px",
									textAlign: "right",
									color: "var(--text2)",
								}}
							>
								{c.conversionRate}%
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MarketplaceOrder } from "@revklik/shared";
import {
	fetchShopeeOrders,
	fetchTokopediaOrders,
	syncShopeeOrders,
	syncTokopediaOrders,
} from "@/lib/api";

export function MarketplaceOrdersSection({
	provider,
	siteId,
}: {
	provider: string;
	siteId: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const queryClient = useQueryClient();

	const fetchOrders =
		provider === "shopee" ? fetchShopeeOrders : fetchTokopediaOrders;
	const syncOrders =
		provider === "shopee" ? syncShopeeOrders : syncTokopediaOrders;

	const { data: orders, isLoading } = useQuery({
		queryKey: ["marketplace-orders", provider, siteId],
		queryFn: () => fetchOrders(siteId) as Promise<MarketplaceOrder[]>,
		enabled: expanded,
	});

	const handleSync = async () => {
		setSyncing(true);
		try {
			await syncOrders(siteId);
			queryClient.invalidateQueries({
				queryKey: ["marketplace-orders", provider, siteId],
			});
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
		} catch {
			/* toast handled by apiFetch */
		} finally {
			setSyncing(false);
		}
	};

	return (
		<div style={{ margin: "0 22px 16px" }}>
			<div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
				<button type="button"
					className="btn-pill"
					style={{ fontSize: 12, padding: "6px 14px" }}
					onClick={handleSync}
					disabled={syncing}
				>
					{syncing ? "Syncing..." : "Sync Orders"}
				</button>
				<button type="button"
					className="btn-pill"
					style={{ fontSize: 12, padding: "6px 14px" }}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "Hide Orders" : "View Orders"}
				</button>
			</div>
			{expanded && (
				<div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
					{isLoading ? (
						<div style={{ padding: 16, textAlign: "center" }}>
							<div className="spinner" />
						</div>
					) : (orders ?? []).length === 0 ? (
						<div
							style={{
								fontSize: 12,
								color: "var(--text3)",
								textAlign: "center",
								padding: 12,
							}}
						>
							No orders found. Click "Sync Orders" to fetch from{" "}
							{provider === "shopee" ? "Shopee" : "Tokopedia"}.
						</div>
					) : (
						<div className="scroll-x">
							<table className="data-table">
								<thead>
									<tr>
										<th>Order SN</th>
										<th>Amount</th>
										<th>Status</th>
										<th>Ordered</th>
									</tr>
								</thead>
								<tbody>
									{(orders ?? []).slice(0, 20).map((o) => (
										<tr key={o.id}>
											<td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
												{o.order_sn}
											</td>
											<td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
												{Number(o.amount).toLocaleString("id-ID", {
													style: "currency",
													currency: o.currency || "IDR",
												})}
											</td>
											<td>
												<span
													style={{
														fontFamily: "var(--mono)",
														fontSize: 10,
														padding: "2px 8px",
														borderRadius: 100,
														background:
															o.status === "completed" || o.status === "SHIPPED"
																? "var(--green-dim)"
																: o.status === "cancelled" ||
																		o.status === "CANCELLED"
																	? "var(--crit-dim)"
																	: "var(--accent-dim)",
														color:
															o.status === "completed" || o.status === "SHIPPED"
																? "var(--green)"
																: o.status === "cancelled" ||
																		o.status === "CANCELLED"
																	? "var(--crit)"
																	: "var(--accent)",
													}}
												>
													{o.status}
												</span>
											</td>
											<td
												style={{
													fontFamily: "var(--mono)",
													fontSize: 10,
													color: "var(--text3)",
												}}
											>
												{new Date(o.ordered_at).toLocaleString("en-GB", {
													day: "numeric",
													month: "short",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

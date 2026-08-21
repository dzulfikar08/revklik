import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { Affiliate, AffiliateStats, Referral } from "@revklik/shared";
import { PageHeader } from "@/components/page-header";
import {
	fetchAffiliate,
	fetchAffiliateReferrals,
	fetchAffiliateStats,
	generateReferralCode,
} from "@/lib/api";

export const Route = createFileRoute("/affiliate")({
	component: AffiliatePage,
});

function AffiliatePage() {
	const qc = useQueryClient();
	const [copied, setCopied] = useState(false);

	const { data: affiliate, isLoading: loadingAffiliate } = useQuery({
		queryKey: ["affiliate"],
		queryFn: () => fetchAffiliate() as Promise<Affiliate>,
	});

	const { data: stats, isLoading: loadingStats } = useQuery({
		queryKey: ["affiliate-stats"],
		queryFn: () => fetchAffiliateStats() as Promise<AffiliateStats>,
		enabled: !!affiliate,
	});

	const { data: referrals, isLoading: loadingReferrals } = useQuery({
		queryKey: ["affiliate-referrals"],
		queryFn: () => fetchAffiliateReferrals() as Promise<Referral[]>,
		enabled: !!affiliate,
	});

	const generateMut = useMutation({
		mutationFn: () => generateReferralCode() as Promise<{ referral_code: string }>,
		onSuccess: () => qc.invalidateQueries({ queryKey: ["affiliate"] }),
	});

	if (loadingAffiliate) return <div className="spinner" />;

	const baseUrl = window.location.origin;
	const referralLink = affiliate?.referral_code
		? `${baseUrl}/register?ref=${affiliate.referral_code}`
		: "";

	const copyLink = () => {
		if (referralLink) {
			navigator.clipboard.writeText(referralLink);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<div className="overview-scroll">
				<PageHeader
					title="Affiliate Program"
					subtitle="Earn commissions by referring new users to RevKlik"
				/>

				<div style={{ maxWidth: 720 }}>
					{/* Referral Link Section */}
					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 12,
							padding: 20,
							marginBottom: 16,
						}}
					>
						<h3
							style={{
								fontFamily: "var(--sans)",

								fontSize: 18,
								color: "var(--text)",
								marginBottom: 12,
							}}
						>
							Your Referral Link
						</h3>
						{affiliate?.referral_code ? (
							<>
								<div
									style={{
										display: "flex",
										gap: 8,
										alignItems: "center",
										marginBottom: 12,
									}}
								>
									<input
										value={referralLink}
										readOnly
										style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12 }}
										onClick={(e) => (e.target as HTMLInputElement).select()}
									/>
									<button
										type="button"
										className="btn-pill"
										style={{ fontSize: 11, padding: "4px 10px" }}
										onClick={copyLink}
									>
										{copied ? "Copied!" : "Copy"}
									</button>
								</div>
								<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
									<span
										style={{
											fontFamily: "var(--mono)",
											fontSize: 11,
											color: "var(--text3)",
										}}
									>
										Code: {affiliate.referral_code}
									</span>
									<button
										type="button"
										className="btn-pill"
										style={{ fontSize: 11, padding: "3px 8px" }}
										onClick={() => generateMut.mutate()}
										disabled={generateMut.isPending}
									>
										{generateMut.isPending ? "Generating..." : "Generate New Code"}
									</button>
								</div>
							</>
						) : (
							<div style={{ color: "var(--text3)", fontSize: 12 }}>Loading referral code...</div>
						)}
					</div>

					{/* Stats Cards */}
					{loadingStats ? (
						<div className="spinner" />
					) : stats ? (
						<div className="affiliate-stats-grid">
							<div
								style={{
									background: "var(--bg2)",
									border: "1px solid var(--border)",
									borderRadius: 12,
									padding: 16,
								}}
							>
								<div
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										fontWeight: 600,
										color: "var(--text3)",
										textTransform: "uppercase",
										letterSpacing: "0.08em",
										marginBottom: 4,
									}}
								>
									Total Referrals
								</div>
								<div
									style={{
										fontFamily: "var(--sans)",

										fontSize: 28,
										color: "var(--text)",
									}}
								>
									{stats.total_referrals}
								</div>
							</div>
							<div
								style={{
									background: "var(--bg2)",
									border: "1px solid var(--border)",
									borderRadius: 12,
									padding: 16,
								}}
							>
								<div
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										fontWeight: 600,
										color: "var(--text3)",
										textTransform: "uppercase",
										letterSpacing: "0.08em",
										marginBottom: 4,
									}}
								>
									Total Earned
								</div>
								<div
									style={{
										fontFamily: "var(--sans)",

										fontSize: 28,
										color: "var(--green)",
									}}
								>
									${stats.total_earned.toFixed(2)}
								</div>
							</div>
							<div
								style={{
									background: "var(--bg2)",
									border: "1px solid var(--border)",
									borderRadius: 12,
									padding: 16,
								}}
							>
								<div
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										fontWeight: 600,
										color: "var(--text3)",
										textTransform: "uppercase",
										letterSpacing: "0.08em",
										marginBottom: 4,
									}}
								>
									Total Paid
								</div>
								<div
									style={{
										fontFamily: "var(--sans)",

										fontSize: 28,
										color: "var(--text)",
									}}
								>
									${stats.total_paid.toFixed(2)}
								</div>
							</div>
							<div
								style={{
									background: "var(--bg2)",
									border: "1px solid var(--border)",
									borderRadius: 12,
									padding: 16,
								}}
							>
								<div
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										fontWeight: 600,
										color: "var(--text3)",
										textTransform: "uppercase",
										letterSpacing: "0.08em",
										marginBottom: 4,
									}}
								>
									Pending
								</div>
								<div
									style={{
										fontFamily: "var(--sans)",

										fontSize: 28,
										color: "var(--accent)",
									}}
								>
									${stats.pending_commissions.toFixed(2)}
								</div>
							</div>
						</div>
					) : null}

					{/* Breakdown by event */}
					{stats?.breakdown && stats.breakdown.length > 0 && (
						<div
							style={{
								background: "var(--bg2)",
								border: "1px solid var(--border)",
								borderRadius: 12,
								padding: 20,
								marginBottom: 16,
							}}
						>
							<h3
								style={{
									fontFamily: "var(--sans)",

									fontSize: 18,
									color: "var(--text)",
									marginBottom: 12,
								}}
							>
								Breakdown by Event
							</h3>
							<div className="scroll-x">
								<table className="data-table">
									<thead>
										<tr>
											<th>Event</th>
											<th>Count</th>
											<th>Commission</th>
										</tr>
									</thead>
									<tbody>
										{stats.breakdown.map((b) => (
											<tr key={b.event}>
												<td style={{ fontSize: 13, textTransform: "capitalize" }}>{b.event}</td>
												<td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{b.count}</td>
												<td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
													${b.total_commission.toFixed(2)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* Referrals Table */}
					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 12,
							padding: 20,
							marginBottom: 16,
						}}
					>
						<h3
							style={{
								fontFamily: "var(--sans)",

								fontSize: 18,
								color: "var(--text)",
								marginBottom: 12,
							}}
						>
							Referrals
						</h3>
						{loadingReferrals ? (
							<div className="spinner" />
						) : referrals && referrals.length > 0 ? (
							<div className="scroll-x">
								<table className="data-table">
									<thead>
										<tr>
											<th>User</th>
											<th>Event</th>
											<th>Commission</th>
											<th>Status</th>
											<th>Date</th>
										</tr>
									</thead>
									<tbody>
										{referrals.map((r) => (
											<tr key={r.id}>
												<td style={{ fontSize: 13 }}>
													{r.referred_user_name ||
														r.referred_user_email ||
														`${r.referred_user_id.slice(0, 8)}...`}
												</td>
												<td style={{ fontSize: 13, textTransform: "capitalize" }}>{r.event}</td>
												<td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
													${r.commission_amount.toFixed(2)}
												</td>
												<td>
													<span
														style={{
															fontFamily: "var(--mono)",
															fontSize: 10,
															padding: "3px 8px",
															borderRadius: 100,
															background:
																r.status === "paid"
																	? "var(--green-dim)"
																	: r.status === "pending"
																		? "var(--accent-dim, rgba(212,136,42,.1))"
																		: "var(--bg3, var(--bg))",
															color:
																r.status === "paid"
																	? "var(--green)"
																	: r.status === "pending"
																		? "var(--accent)"
																		: "var(--text3)",
															border: `1px solid ${r.status === "paid" ? "rgba(52,211,153,.2)" : r.status === "pending" ? "rgba(212,136,42,.2)" : "var(--border)"}`,
														}}
													>
														{r.status}
													</span>
												</td>
												<td
													style={{
														fontFamily: "var(--mono)",
														fontSize: 11,
														color: "var(--text3)",
													}}
												>
													{new Date(r.created_at).toLocaleDateString()}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<div style={{ color: "var(--text3)", fontSize: 12 }}>
								No referrals yet. Share your link to start earning!
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

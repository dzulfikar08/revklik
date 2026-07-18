import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { PlanInfo } from "shared";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import {
	createCheckout,
	createPakasirCheckout,
	fetchPlans,
	fetchSubscription,
	logout,
} from "@/lib/api";

export const Route = createFileRoute("/paywall")({ component: PaywallPage });

const PLAN_META: Record<string, { label: string; popular?: boolean }> = {
	micro: { label: "Micro" },
	starter: { label: "Starter", popular: true },
	growth: { label: "Growth" },
};

const IDR_PRICES: Record<string, string> = {
	micro: "Rp 16.000",
	starter: "Rp 64.000",
	growth: "Rp 192.000",
};

function PaywallPage() {
	const qc = useQueryClient();

	const { data: subscription } = useQuery({
		queryKey: ["subscription"],
		queryFn: fetchSubscription,
		staleTime: 5 * 60 * 1000,
	});

	const { data: plans, isLoading } = useQuery({
		queryKey: ["plans"],
		queryFn: fetchPlans,
	});

	const checkoutMut = useMutation({
		mutationFn: (tier: string) => createCheckout(tier),
		onSuccess: (data) => {
			window.location.href = data.url;
		},
		onError: (err) => toast(err.message, "error"),
	});

	const pakasirMut = useMutation({
		mutationFn: (tier: string) => createPakasirCheckout(tier),
		onSuccess: (data) => {
			window.location.href = data.url;
		},
		onError: (err) => toast(err.message, "error"),
	});

	if (isLoading) return <div className="spinner" />;

	const currentPlan = subscription?.plan;
	const isActive =
		subscription?.status === "active" || subscription?.status === "trialing";
	const isTrial = subscription?.status === "trialing";
	const trialDays = subscription?.trial_days_remaining;

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
					title="Choose a Plan"
					subtitle="Select a plan to get started with RevKlik"
				/>

				{isTrial && trialDays !== null && trialDays !== undefined && (
					<div
						style={{
							margin: "0 24px 20px",
							padding: "14px 18px",
							borderRadius: 12,
							background: "rgba(52,211,153,.08)",
							border: "1px solid rgba(52,211,153,.2)",
							display: "flex",
							alignItems: "center",
							gap: 12,
						}}
					>
						<div
							style={{
								width: 36,
								height: 36,
								borderRadius: 10,
								background: "rgba(52,211,153,.12)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexShrink: 0,
							}}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#34d399"
								strokeWidth="2"
							 aria-hidden="true">
								<circle cx="12" cy="12" r="10" />
								<path d="M12 6v6l4 2" />
							</svg>
						</div>
						<div style={{ flex: 1 }}>
							<div
								style={{
									fontSize: 13,
									fontWeight: 600,
									color: "#34d399",
									marginBottom: 2,
								}}
							>
								7-Day Free Trial Active
							</div>
							<div style={{ fontSize: 12, color: "var(--text2)" }}>
								{trialDays > 0
									? `${trialDays} day${trialDays === 1 ? "" : "s"} remaining — subscribe now to keep access after trial ends`
									: "Your trial has ended — choose a plan to continue"}
							</div>
						</div>
					</div>
				)}

				<div className="paywall-container">
					<div className="paywall-cards">
						{(plans as PlanInfo[] | undefined)?.map((plan) => {
							const meta = PLAN_META[plan.tier] || { label: plan.name };
							const isCurrent = currentPlan === plan.tier && isActive;

							return (
								<div
									key={plan.tier}
									style={{
										background: "var(--bg2)",
										border: `1px solid ${isCurrent ? "var(--accent)" : meta.popular ? "var(--accent)" : "var(--border)"}`,
										borderRadius: 12,
										padding: 24,
										display: "flex",
										flexDirection: "column",
										position: "relative",
									}}
								>
									{meta.popular && (
										<div
											style={{
												position: "absolute",
												top: -10,
												right: 16,
												background: "var(--accent)",
												color: "#fff",
												fontFamily: "var(--mono)",
												fontSize: 9,
												fontWeight: 600,
												textTransform: "uppercase",
												letterSpacing: "0.08em",
												padding: "3px 10px",
												borderRadius: 100,
											}}
										>
											Popular
										</div>
									)}

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
										{meta.label}
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "baseline",
											gap: 4,
											marginBottom: 4,
										}}
									>
										<span
											style={{
												fontFamily: "var(--serif)",
												fontStyle: "italic",
												fontSize: 36,
												color: "var(--text)",
											}}
										>
											${plan.price}
										</span>
										<span style={{ fontSize: 12, color: "var(--text3)" }}>
											/mo
										</span>
									</div>
									<div
										style={{
											fontSize: 11,
											color: "var(--text3)",
											marginBottom: 16,
										}}
									>
										{IDR_PRICES[plan.tier] || ""}
									</div>

									<ul
										style={{
											listStyle: "none",
											padding: 0,
											margin: 0,
											flex: 1,
											marginBottom: 20,
										}}
									>
										{plan.features.map((f) => (
											<li
												key={f}
												style={{
													fontSize: 12,
													color: "var(--text2)",
													padding: "4px 0",
													display: "flex",
													gap: 8,
													alignItems: "center",
												}}
											>
												<span style={{ color: "var(--accent)", fontSize: 10 }}>
													&#10003;
												</span>
												{f}
											</li>
										))}
									</ul>

									{isCurrent ? (
										<button type="button"
											disabled
											style={{
												width: "100%",
												padding: "10px 20px",
												borderRadius: 8,
												background: "var(--bg3, var(--bg))",
												color: "var(--text3)",
												border: "1px solid var(--border)",
												fontSize: 13,
												fontWeight: 500,
												cursor: "default",
											}}
										>
											Current Plan
										</button>
									) : (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: 8,
											}}
										>
											<button type="button"
												className={meta.popular ? "btn-accent" : ""}
												onClick={() => checkoutMut.mutate(plan.tier)}
												disabled={checkoutMut.isPending}
												style={
													!meta.popular
														? {
																width: "100%",
																padding: "10px 20px",
																borderRadius: 8,
																background: "transparent",
																color: "var(--text)",
																border: "1px solid var(--border)",
																fontSize: 13,
																fontWeight: 500,
																cursor: "pointer",
																justifyContent: "center",
															}
														: { width: "100%", justifyContent: "center" }
												}
											>
												{checkoutMut.isPending
													? "Redirecting..."
													: currentPlan
														? "Upgrade"
														: "Pay with Card"}
											</button>
											<button type="button"
												onClick={() => pakasirMut.mutate(plan.tier)}
												disabled={pakasirMut.isPending}
												style={{
													width: "100%",
													padding: "10px 20px",
													borderRadius: 8,
													background: "transparent",
													color: "var(--text2)",
													border: "1px solid var(--border)",
													fontSize: 12,
													fontWeight: 500,
													cursor: "pointer",
													justifyContent: "center",
												}}
											>
												{pakasirMut.isPending ? "Loading..." : "Pay with QRIS"}
											</button>
										</div>
									)}
								</div>
							);
						})}
					</div>

					<div style={{ textAlign: "center", marginBottom: 24 }}>
						<button type="button"
							className="btn-pill"
							style={{ fontSize: 11, padding: "4px 10px" }}
							onClick={() => {
								logout();
								qc.clear();
								window.location.href = "/login";
							}}
						>
							Logout
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

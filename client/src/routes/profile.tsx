import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Subscription } from "shared";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import {
	cancelSubscription,
	fetchSubscription,
	getCurrentUser,
} from "@/lib/api";

export const Route = createFileRoute("/profile")({ component: ProfilePage });

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
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
					marginBottom: 16,
				}}
			>
				{title}
			</h3>
			{children}
		</div>
	);
}

function UsageBar({
	label,
	used,
	limit,
}: {
	label: string;
	used: number;
	limit: number;
}) {
	const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
	const color =
		pct >= 90 ? "var(--crit)" : pct >= 70 ? "var(--accent)" : "var(--green)";
	return (
		<div style={{ marginBottom: 12 }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					marginBottom: 4,
				}}
			>
				<span
					style={{
						fontFamily: "var(--mono)",
						fontSize: 10,
						fontWeight: 600,
						color: "var(--text3)",
						textTransform: "uppercase",
						letterSpacing: "0.08em",
					}}
				>
					{label}
				</span>
				<span
					style={{
						fontFamily: "var(--mono)",
						fontSize: 10,
						color: "var(--text3)",
					}}
				>
					{used.toLocaleString()} / {limit.toLocaleString()}
				</span>
			</div>
			<div
				style={{
					height: 6,
					background: "var(--bg3, var(--bg))",
					borderRadius: 3,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						height: "100%",
						width: `${pct}%`,
						background: color,
						borderRadius: 3,
						transition: "width 0.3s",
					}}
				/>
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const colors: Record<string, { bg: string; color: string; border: string }> =
		{
			active: {
				bg: "var(--green-dim)",
				color: "var(--green)",
				border: "rgba(52,211,153,.2)",
			},
			trialing: {
				bg: "rgba(96,165,250,.1)",
				color: "#60a5fa",
				border: "rgba(96,165,250,.2)",
			},
			canceled: {
				bg: "var(--crit-dim)",
				color: "var(--crit)",
				border: "rgba(239,68,68,.2)",
			},
			past_due: {
				bg: "var(--accent-dim, rgba(212,136,42,.1))",
				color: "var(--accent)",
				border: "rgba(212,136,42,.2)",
			},
		};
	const c = colors[status] || colors.active;
	return (
		<span
			style={{
				fontFamily: "var(--mono)",
				fontSize: 10,
				padding: "3px 10px",
				borderRadius: 100,
				background: c.bg,
				color: c.color,
				border: `1px solid ${c.border}`,
				textTransform: "capitalize",
			}}
		>
			{status.replace("_", " ")}
		</span>
	);
}

function ProfilePage() {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const [confirmCancel, setConfirmCancel] = useState(false);
	const user = getCurrentUser();

	const { data: subscription, isLoading: subLoading } = useQuery<Subscription>({
		queryKey: ["subscription"],
		queryFn: fetchSubscription,
	});

	const cancelMut = useMutation({
		mutationFn: () => cancelSubscription(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["subscription"] });
			setConfirmCancel(false);
			toast("Subscription will cancel at period end", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	const isPaid = subscription?.plan && subscription.plan !== "micro";
	const isActive =
		subscription?.status === "active" || subscription?.status === "trialing";
	const planName = subscription?.plan
		? subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)
		: "Micro";

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
				<PageHeader title="Profile" subtitle="Your account and billing" />

				<div style={{ maxWidth: 720 }}>
					{/* Account */}
					<Section title="Account">
						<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
							<div
								style={{
									width: 48,
									height: 48,
									borderRadius: 12,
									background: "var(--bg3, var(--bg))",
									border: "1px solid var(--border)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontFamily: "var(--sans)",
									
									fontSize: 20,
									color: "var(--accent)",
									overflow: "hidden",
								}}
							>
								{user?.avatar_url ? (
									<img
										src={user.avatar_url}
										alt=""
										style={{
											width: "100%",
											height: "100%",
											objectFit: "cover",
										}}
									/>
								) : (
									(user?.name || "?").charAt(0).toUpperCase()
								)}
							</div>
							<div>
								<div
									style={{
										fontSize: 15,
										fontWeight: 500,
										color: "var(--text)",
										marginBottom: 2,
									}}
								>
									{user?.name || "User"}
								</div>
								<div
									style={{
										fontSize: 12,
										color: "var(--text3)",
										fontFamily: "var(--mono)",
									}}
								>
									{user?.email || "—"}
								</div>
							</div>
						</div>
					</Section>

					{/* Subscription */}
					<Section title="Subscription">
						{subLoading ? (
							<div className="spinner" />
						) : subscription ? (
							<>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 12,
										marginBottom: 16,
									}}
								>
									<div
										style={{
											fontSize: 15,
											fontWeight: 500,
											color: "var(--text)",
										}}
									>
										{planName} Plan
									</div>
									<StatusBadge status={subscription.status} />
									{subscription.cancel_at_period_end && (
										<span style={{ fontSize: 11, color: "var(--crit)" }}>
											Cancels{" "}
											{new Date(
												subscription.current_period_end,
											).toLocaleDateString()}
										</span>
									)}
								</div>

								{isPaid && subscription.current_period_end && (
									<div
										style={{
											fontSize: 12,
											color: "var(--text3)",
											marginBottom: 16,
											fontFamily: "var(--mono)",
										}}
									>
										{subscription.cancel_at_period_end
											? "Access until"
											: "Renews on"}{" "}
										{new Date(
											subscription.current_period_end,
										).toLocaleDateString()}
									</div>
								)}

								<div style={{ display: "flex", gap: 8 }}>
									<button type="button"
										className="btn-accent"
										style={{ fontSize: 12, padding: "6px 14px" }}
										onClick={() => navigate({ to: "/paywall" })}
									>
										{isPaid ? "Change Plan" : "Upgrade"}
									</button>

									{isPaid &&
										isActive &&
										!subscription.cancel_at_period_end &&
										(confirmCancel ? (
											<div
												style={{
													display: "flex",
													gap: 8,
													alignItems: "center",
												}}
											>
												<span style={{ fontSize: 11, color: "var(--text3)" }}>
													Cancel subscription?
												</span>
												<button type="button"
													className="btn-pill"
													style={{
														fontSize: 11,
														padding: "4px 10px",
														color: "var(--crit)",
													}}
													onClick={() => cancelMut.mutate()}
													disabled={cancelMut.isPending}
												>
													{cancelMut.isPending ? "Cancelling..." : "Yes"}
												</button>
												<button type="button"
													className="btn-pill"
													style={{ fontSize: 11, padding: "4px 10px" }}
													onClick={() => setConfirmCancel(false)}
												>
													No
												</button>
											</div>
										) : (
											<button type="button"
												className="btn-pill"
												style={{ fontSize: 11, padding: "4px 10px" }}
												onClick={() => setConfirmCancel(true)}
											>
												Cancel Subscription
											</button>
										))}
								</div>
							</>
						) : (
							<div style={{ color: "var(--text3)", fontSize: 12 }}>
								Unable to load subscription
							</div>
						)}
					</Section>

					{/* Usage */}
					{subscription?.usage && (
						<Section title="Usage This Month">
							<UsageBar
								label="Events"
								used={subscription.usage.events.used}
								limit={subscription.usage.events.limit}
							/>
							<UsageBar
								label="Sites"
								used={subscription.usage.sites.used}
								limit={subscription.usage.sites.limit}
							/>
						</Section>
					)}
				</div>
			</div>
		</div>
	);
}

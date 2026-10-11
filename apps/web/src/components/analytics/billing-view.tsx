import { Button } from "@revklik/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, CreditCard, QrCode, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { LocaleToggle } from "@/components/locale-toggle";
import { formatDate, useLocale, useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { isPlanRequired, LegacyApiError } from "@/lib/legacy/api";
import {
	IDR_PRICE,
	cancelSubscription,
	createCheckout,
	createPakasirCheckout,
	fetchPlans,
	fetchSubscription,
	parsePlan,
	planLabel,
	subscriptionState,
	verifyPakasirPayment,
} from "@/lib/legacy/billing";
import type {
	BillingPlan,
	BillingSubscription,
	CheckoutResult,
	PlanTier,
	SubscriptionStatus,
} from "@/lib/legacy/billing";

import { money } from "./data";
import { Panel } from "./ui";

/* ------------------------------- data hook -------------------------------- */

export const SUBSCRIPTION_KEY = ["legacy", "subscription"] as const;

/**
 * Shared subscription query for the legacy klikapa billing API.
 * Import this from any panel that needs plan-aware behaviour.
 */
export const useSubscription = () =>
	useQuery({
		queryFn: fetchSubscription,
		queryKey: SUBSCRIPTION_KEY,
		retry: false,
		staleTime: 60_000,
	});

/**
 * Plans plus `qris_available`. That flag (set by visitor country) is the one
 * rule for showing IDR or USD prices anywhere in the app.
 */
export const usePlans = () =>
	useQuery({
		queryFn: fetchPlans,
		queryKey: ["legacy", "plans"],
		retry: false,
		staleTime: 300_000,
	});

/** Mutation error toast; plan errors already get the global upgrade toast. */
const toastError = (err: Error): void => {
	if (!isPlanRequired(err)) {
		toast.error(err.message);
	}
};

/* ------------------------------- formatting ------------------------------- */

const PLAN_LIMIT_KEY: Record<PlanTier, MessageKey> = {
	micro: "billing.limits.micro",
	starter: "billing.limits.starter",
	growth: "billing.limits.growth",
};

/**
 * Feature strings come from the API. The script-size line there predates
 * the current tracker (measured ~3.7 KB gzipped), so it is corrected here
 * until the worker copy changes.
 */
const FEATURE_FIXES: Record<string, string> = {
	"<1KB script": "Lightweight script (~4 KB gzipped)",
};

const STATUS_TONE: Record<string, string> = {
	active: "bg-(--up)/10 text-(--up) ring-(--up)/20",
	trialing: "bg-sky-400/10 text-sky-700 ring-sky-400/30 dark:text-sky-300",
	past_due: "bg-(--down)/10 text-(--down) ring-(--down)/20",
	canceled: "bg-(--down)/10 text-(--down) ring-(--down)/20",
};

const STATUS_LABEL: Record<SubscriptionStatus, MessageKey> = {
	active: "billing.status.active",
	trialing: "billing.status.trialing",
	past_due: "billing.status.pastDue",
	canceled: "billing.status.canceled",
};

const StatusBadge = ({ status, label }: { status: string; label: string }) => (
	<span
		className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] ring-1 ${
			STATUS_TONE[status] ?? "bg-muted/60 text-muted-foreground ring-foreground/10"
		}`}
	>
		{label}
	</span>
);

const UsageBar = ({ label, used, limit }: { label: string; used: number; limit: number }) => {
	const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
	return (
		<div>
			<div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
				<span>{label}</span>
				<span className="font-mono tabular-nums">
					{used.toLocaleString()} / {limit.toLocaleString()}
				</span>
			</div>
			<div className="bg-muted h-1.5 overflow-hidden rounded-full">
				<div className="bg-(--chart) h-full rounded-full" style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
};

/* ---------------------------- subscription banner -------------------------- */

type BannerKind = "trial" | "trialEnded" | "pastDue" | "canceled" | "cancelling";

const bannerKind = (sub: BillingSubscription): BannerKind | null => {
	const state = subscriptionState(sub);
	if (state.trialing) return state.trialEnded ? "trialEnded" : "trial";
	if (sub.status === "past_due") return "pastDue";
	if (!state.paidActive) return "canceled";
	if (sub.cancel_at_period_end) return "cancelling";
	return null;
};

const DISMISS_KEY = "kp_billing_banner_dismissed";

export const SubscriptionBanner = ({ onUpgrade }: { onUpgrade: () => void }) => {
	const t = useT();
	const locale = useLocale();
	const { data: sub } = useSubscription();
	const [dismissed, setDismissed] = useState<string | null>(() => {
		try {
			return sessionStorage.getItem(DISMISS_KEY);
		} catch {
			return null;
		}
	});

	// No subscription row at all (id "") is a legacy account, not a lapse.
	if (!sub || !sub.id) return null;
	const kind = bannerKind(sub);
	if (!kind || dismissed === kind) return null;

	const dismiss = () => {
		setDismissed(kind);
		try {
			sessionStorage.setItem(DISMISS_KEY, kind);
		} catch {
			/* ignore */
		}
	};

	const days = subscriptionState(sub).trialDaysLeft;
	const warn = kind !== "trial";
	const tone = warn
		? "bg-(--down)/10 text-(--down) ring-(--down)/20"
		: "bg-(--up)/10 text-(--up) ring-(--up)/20";
	const Icon = warn ? AlertTriangle : Clock;
	let message: string;
	if (kind === "trial") {
		message = days > 0 ? t("banner.trial", { n: days }) : t("banner.trialToday");
	} else if (kind === "cancelling") {
		message = t("banner.cancelling", { date: formatDate(sub.current_period_end, locale) });
	} else {
		message = t(`banner.${kind}`);
	}

	return (
		<div
			className={`mb-2.5 flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-2 text-xs ring-1 ${tone}`}
			role="status"
		>
			<Icon className="size-3.5 shrink-0" aria-hidden />
			<p className="min-w-0 flex-1">{message}</p>
			<Button size="xs" onClick={onUpgrade}>
				{t("lock.cta")}
			</Button>
			<button
				type="button"
				aria-label={t("billing.dismiss")}
				onClick={dismiss}
				className="hover:text-foreground focus-visible:outline-ring -mx-1 rounded-md p-1 opacity-70 transition-opacity outline-offset-2 hover:opacity-100 focus-visible:outline-2"
			>
				<X className="size-3.5" aria-hidden />
			</button>
		</div>
	);
};

/* --------------------------------- view ----------------------------------- */

interface PendingQris {
	orderId: string;
	plan: string;
	url: string;
	amount?: number;
}

const PENDING_DISMISS_KEY = "kp_qris_pending_dismissed";

type PlanBadge = "trial" | "picked" | null;

const PlanCard = ({
	plan,
	isCurrent,
	badge,
	highlighted,
	busy,
	onCard,
	onQris,
	qrisAvailable,
}: {
	plan: BillingPlan;
	isCurrent: boolean;
	badge: PlanBadge;
	highlighted: boolean;
	busy: boolean;
	onCard: (tier: PlanTier) => void;
	onQris: (tier: PlanTier) => void;
	qrisAvailable: boolean;
}) => {
	const t = useT();
	const ref = useRef<HTMLDivElement>(null);
	const idr = plan.price_idr ?? IDR_PRICE[plan.tier];
	const usd = money(plan.price);

	useEffect(() => {
		if (highlighted) {
			ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
	}, [highlighted]);

	return (
		<div
			ref={ref}
			className={`relative flex flex-col rounded-xl bg-card p-4 ring-1 ${
				isCurrent || highlighted ? "bg-(--chart)/5 ring-(--chart)" : "ring-foreground/10"
			}`}
		>
			{badge && !isCurrent ? (
				<span className="bg-(--chart) text-background absolute -top-2 right-3 rounded-full px-2 py-0.5 text-[10px] font-semibold">
					{badge === "trial" ? t("billing.trialBadge") : t("billing.pickedBadge")}
				</span>
			) : null}
			<h3 className="text-muted-foreground font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
				{planLabel(plan.tier)}
			</h3>
			<div className="mt-1 flex items-baseline gap-1.5">
				<span className="text-3xl font-semibold tracking-tight tabular-nums">
					{qrisAvailable ? money(idr, "IDR") : usd}
				</span>
				<span className="text-muted-foreground text-xs">{t("billing.perMonth")}</span>
			</div>
			{qrisAvailable ? (
				<div className="text-muted-foreground mt-0.5 text-xs">
					{t("billing.byCard", { price: usd })}
				</div>
			) : null}
			<div className="text-muted-foreground mt-0.5 text-[11px]">{t(PLAN_LIMIT_KEY[plan.tier])}</div>
			<ul className="mt-3 mb-4 flex-1 space-y-1">
				{plan.features.map((f) => (
					<li key={f} className="text-muted-foreground flex items-center gap-2 text-xs">
						<Check className="text-(--chart) size-3 shrink-0" aria-hidden />
						{FEATURE_FIXES[f] ?? f}
					</li>
				))}
			</ul>
			{isCurrent ? (
				<Button variant="outline" size="sm" disabled className="w-full">
					{t("billing.currentBtn")}
				</Button>
			) : (
				<div className="flex flex-col gap-2">
					{qrisAvailable ? (
						<Button size="sm" className="h-9" disabled={busy} onClick={() => onQris(plan.tier)}>
							<QrCode className="size-3.5" aria-hidden />
							{t("billing.payQris")}
						</Button>
					) : null}
					<Button
						size="sm"
						variant={qrisAvailable ? "outline" : "default"}
						className="h-9 w-full"
						disabled={busy}
						onClick={() => onCard(plan.tier)}
					>
						<CreditCard className="size-3.5" aria-hidden />
						{t("billing.payCard")}
					</Button>
				</div>
			)}
		</div>
	);
};

/** Text under the plan name: when the trial or period ends or renews. */
const periodLine = (
	sub: BillingSubscription,
	t: ReturnType<typeof useT>,
	date: (iso: string) => string,
): string => {
	if (!sub.id) return t("billing.noPlan");
	const state = subscriptionState(sub);
	if (state.trialing) {
		if (state.trialEnded) return t("billing.trialEnded");
		return state.trialDaysLeft > 0
			? t("billing.trialEndsIn", { n: state.trialDaysLeft })
			: t("billing.trialEndsToday");
	}
	if (!state.paidActive) return t("billing.endedOn", { date: date(sub.current_period_end) });
	// QRIS purchases (no Polar subscription) cover one period and never renew.
	return sub.cancel_at_period_end || !sub.polar_subscription_id
		? t("billing.accessUntil", { date: date(sub.current_period_end) })
		: t("billing.renews", { date: date(sub.current_period_end) });
};

export const BillingView = ({
	highlightPlan,
	checkout,
	onCheckoutHandled,
}: {
	/** Tier to emphasise, e.g. the one picked on the pricing page. */
	highlightPlan?: PlanTier;
	/** Set when a payment provider just sent the browser back. */
	checkout?: CheckoutResult;
	onCheckoutHandled?: () => void;
}) => {
	const t = useT();
	const locale = useLocale();
	const qc = useQueryClient();
	const subQ = useSubscription();
	const plansQ = usePlans();

	const sub = subQ.data;
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [localPending, setLocalPending] = useState<PendingQris | null>(null);
	const [dismissedOrder, setDismissedOrder] = useState<string | null>(() => {
		try {
			return sessionStorage.getItem(PENDING_DISMISS_KEY);
		} catch {
			return null;
		}
	});

	const refreshSubscription = () => qc.invalidateQueries({ queryKey: SUBSCRIPTION_KEY });

	const checkoutMut = useMutation({
		mutationFn: createCheckout,
		onError: (err) => {
			// 503: card checkout (Polar) is not configured or down.
			if (err instanceof LegacyApiError && err.status === 503) {
				toast.error(t("billing.cardUnavailable"));
				return;
			}
			toastError(err);
		},
		onSuccess: (data) => {
			window.location.href = data.url;
		},
	});

	const pakasirMut = useMutation({
		mutationFn: createPakasirCheckout,
		onError: toastError,
		onSuccess: (data) => {
			setLocalPending({
				amount: data.amount,
				orderId: data.order_id,
				plan: data.plan,
				url: data.url,
			});
			window.open(data.url, "_blank", "noopener");
			toast.info(t("billing.qrisOpened"));
		},
	});

	const verifyMut = useMutation({
		mutationFn: verifyPakasirPayment,
		onError: toastError,
		onSuccess: (res) => {
			if (res.status === "active") {
				setLocalPending(null);
				const plan = parsePlan(res.plan);
				toast.success(
					plan ? t("billing.paid", { plan: planLabel(plan) }) : t("billing.paidGeneric"),
				);
			} else if (res.status === "pending") {
				toast.info(t("billing.stillPending"));
			}
			void refreshSubscription();
		},
	});

	// Back from a payment provider: confirm, refetch, and drop ?checkout=
	// so a reload does not repeat it. Polar's webhook can trail the
	// redirect, so the subscription is fetched once more a few seconds later.
	const handledCheckout = useRef(false);
	// Separate from the effect below: clearing ?checkout= re-runs that effect,
	// and its cleanup must not cancel the delayed refetch. Cleared on unmount.
	const refetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(refetchTimer.current), []);
	useEffect(() => {
		if (!checkout || handledCheckout.current) return;
		handledCheckout.current = true;
		if (checkout === "pakasir_success") {
			verifyMut.mutate();
		} else {
			toast.success(t("billing.checkoutSuccess"));
			void refreshSubscription();
			refetchTimer.current = setTimeout(() => void refreshSubscription(), 5000);
		}
		onCheckoutHandled?.();
		// Runs once per return; the mutation and callbacks are stable enough here.
		// oxlint-disable-next-line react-hooks/exhaustive-deps
	}, [checkout]);

	const cancelMut = useMutation({
		mutationFn: cancelSubscription,
		onError: toastError,
		onSuccess: () => {
			void refreshSubscription();
			toast.success(t("billing.cancelDone"));
		},
	});

	const serverPending = sub?.pending_order;
	const pendingQris: PendingQris | null =
		localPending ??
		(serverPending && serverPending.order_id !== dismissedOrder
			? {
					amount: serverPending.amount,
					orderId: serverPending.order_id,
					plan: serverPending.plan,
					url: serverPending.checkout_url,
				}
			: null);

	const dismissPending = () => {
		if (!pendingQris) return;
		setLocalPending(null);
		setDismissedOrder(pendingQris.orderId);
		try {
			sessionStorage.setItem(PENDING_DISMISS_KEY, pendingQris.orderId);
		} catch {
			/* ignore */
		}
	};

	const plans = plansQ.data?.plans ?? [];
	// QRIS needs an Indonesian bank/e-wallet app; the server decides by the
	// visitor's country, so the same flag picks IDR as the headline price.
	const qrisAvailable = plansQ.data?.qris_available ?? false;
	const busy = checkoutMut.isPending || pakasirMut.isPending;
	const state = sub ? subscriptionState(sub) : null;
	// Only Polar (card) subscriptions renew, so only they can be canceled;
	// a paid plan without one was bought with QRIS for a single period.
	const isQrisPlan = Boolean(sub?.id && state?.paidActive && !sub.polar_subscription_id);
	const canCancel = Boolean(
		sub?.id && state?.paidActive && sub.polar_subscription_id && !sub.cancel_at_period_end,
	);
	const date = (iso: string) => formatDate(iso, locale);
	const pendingPlan = pendingQris ? parsePlan(pendingQris.plan) : undefined;

	const badgeFor = (tier: PlanTier): PlanBadge => {
		if (highlightPlan === tier) return "picked";
		if (state?.trialing && !state.trialEnded && sub?.plan === tier) return "trial";
		return null;
	};

	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
				<div>
					<h1 className="text-lg font-semibold tracking-tight">{t("billing.title")}</h1>
					<p className="text-muted-foreground text-xs">{t("billing.subtitle")}</p>
				</div>
				<LocaleToggle />
			</div>

			{pendingQris ? (
				<section className="bg-card ring-(--chart)/40 mb-2.5 flex flex-wrap items-center gap-3 rounded-2xl p-3 ring-1">
					<div className="bg-(--chart)/10 text-(--chart) flex size-9 shrink-0 items-center justify-center rounded-xl">
						<QrCode className="size-4" aria-hidden />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-[13px] font-medium">
							{t("billing.qrisTitle")}
							{pendingPlan ? ` · ${planLabel(pendingPlan)}` : ""}
							{pendingQris.amount ? ` · ${money(pendingQris.amount, "IDR")}` : ""}
						</p>
						<p className="text-muted-foreground truncate font-mono text-[11px]">
							{t("billing.qrisOrder", { id: pendingQris.orderId })}
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => window.open(pendingQris.url, "_blank", "noopener")}
					>
						{t("billing.qrisReopen")}
					</Button>
					<Button size="sm" disabled={verifyMut.isPending} onClick={() => verifyMut.mutate()}>
						{verifyMut.isPending ? t("billing.qrisVerifying") : t("billing.qrisVerify")}
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("billing.dismiss")}
						onClick={dismissPending}
					>
						<X className="size-3.5" aria-hidden />
					</Button>
				</section>
			) : null}

			<Panel title={t("billing.current")}>
				{subQ.isLoading ? (
					<p className="text-muted-foreground py-4 text-center text-xs">
						{t("billing.loadingSub")}
					</p>
				) : subQ.error || !sub || !state ? (
					<p className="text-(--down) py-4 text-center text-xs" role="alert">
						{t("billing.subError")}
					</p>
				) : (
					<div className="grid gap-4">
						<div className="flex flex-wrap items-center gap-3">
							<span className="text-[15px] font-medium">
								{t("billing.planName", { plan: planLabel(sub.plan) })}
							</span>
							{sub.id ? (
								<StatusBadge
									status={state.trialEnded ? "canceled" : sub.status}
									label={
										state.trialEnded
											? t("billing.trialEnded")
											: sub.status in STATUS_LABEL
												? t(STATUS_LABEL[sub.status as SubscriptionStatus])
												: sub.status.replace("_", " ")
									}
								/>
							) : null}
							{sub.cancel_at_period_end && state.paidActive ? (
								<span className="text-(--down) text-[11px]">
									{t("billing.cancels", { date: date(sub.current_period_end) })}
								</span>
							) : null}
						</div>

						<div className="grid gap-1">
							<p className="text-muted-foreground font-mono text-xs">{periodLine(sub, t, date)}</p>
							{state.trialing && !state.trialEnded ? (
								<p className="text-muted-foreground max-w-prose text-xs">
									{t("billing.trialNote")}
								</p>
							) : null}
						</div>

						{sub.usage ? (
							<div className="grid gap-3 sm:grid-cols-2">
								<UsageBar
									label={t("billing.usageEvents")}
									used={sub.usage.events.used}
									limit={sub.usage.events.limit}
								/>
								<UsageBar
									label={t("billing.usageSites")}
									used={sub.usage.sites.used}
									limit={sub.usage.sites.limit}
								/>
							</div>
						) : null}

						{canCancel ? (
							confirmCancel ? (
								<div className="flex flex-wrap items-center gap-2.5">
									<span className="text-muted-foreground text-xs">
										{t("billing.cancelConfirm", { date: date(sub.current_period_end) })}
									</span>
									<Button
										variant="destructive"
										size="xs"
										disabled={cancelMut.isPending}
										onClick={() => cancelMut.mutate()}
									>
										{cancelMut.isPending ? t("billing.cancelling") : t("billing.cancelYes")}
									</Button>
									<Button variant="ghost" size="xs" onClick={() => setConfirmCancel(false)}>
										{t("billing.cancelNo")}
									</Button>
								</div>
							) : (
								<div>
									<Button variant="outline" size="xs" onClick={() => setConfirmCancel(true)}>
										{t("billing.cancelBtn")}
									</Button>
								</div>
							)
						) : isQrisPlan ? (
							<p className="text-muted-foreground max-w-prose text-xs">
								{t("billing.qrisNoRenew", { date: date(sub.current_period_end) })}
							</p>
						) : null}
					</div>
				)}
			</Panel>

			<div className="mt-2.5">
				<Panel title={t("billing.plans")} hint={t("billing.plansHint")}>
					{plansQ.isLoading ? (
						<p className="text-muted-foreground py-4 text-center text-xs">
							{t("billing.loadingPlans")}
						</p>
					) : plansQ.error || plans.length === 0 ? (
						<p className="text-(--down) py-4 text-center text-xs" role="alert">
							{t("billing.plansError")}
						</p>
					) : (
						<>
							<div className="grid gap-2.5 md:grid-cols-3">
								{plans.map((plan) => (
									<PlanCard
										key={plan.tier}
										plan={plan}
										// A trial is never "current": the trial's own tier stays buyable.
										isCurrent={Boolean(sub?.id && state?.paidActive && sub.plan === plan.tier)}
										badge={badgeFor(plan.tier)}
										highlighted={highlightPlan === plan.tier}
										busy={busy}
										onCard={(tier) => checkoutMut.mutate(tier)}
										onQris={(tier) => pakasirMut.mutate(tier)}
										qrisAvailable={qrisAvailable}
									/>
								))}
							</div>
							{qrisAvailable ? null : (
								<p className="text-muted-foreground mt-2 px-1 text-[11px]">
									{t("billing.qrisIdOnly")}
								</p>
							)}
						</>
					)}
				</Panel>
			</div>
		</main>
	);
};

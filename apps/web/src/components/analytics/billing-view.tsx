import { Button } from "@revklik/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CreditCard, QrCode, X } from "lucide-react";
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
	isOpenEnded,
	parsePlan,
	planLabel,
	subscriptionState,
	usageLevel,
	verifyPakasirPayment,
} from "@/lib/legacy/billing";
import type {
	BillingPlan,
	BillingSubscription,
	CheckoutResult,
	PlanTier,
	SubscriptionStatus,
	UsageLevel,
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
 * What each tier adds over the one below it. Written here rather than read
 * from /billing/plans `features`: those strings are English-only, repeat the
 * whole base list on every tier, and the native app still renders them as-is.
 * Facts mirror the worker gates (app.ts requirePlanTier, plans.ts limits).
 */
const PLAN_FEATURES: Record<PlanTier, MessageKey[]> = {
	micro: [
		"billing.feature.cookieless",
		"billing.feature.profiles",
		"billing.feature.utm",
		"billing.feature.csv",
	],
	starter: ["billing.feature.funnels", "billing.feature.revenue"],
	growth: [
		"billing.feature.ai",
		"billing.feature.heatmaps",
		"billing.feature.replays",
		"billing.feature.integrations",
		"billing.feature.team",
		"billing.feature.support",
	],
};

const PLAN_INCLUDES: Record<PlanTier, MessageKey> = {
	micro: "billing.includes.micro",
	starter: "billing.includes.starter",
	growth: "billing.includes.growth",
};

const STATUS_TONE: Record<string, string> = {
	active: "bg-(--up)/10 text-(--up) ring-(--up)/25",
	trialing: "bg-(--chart)/10 text-(--chart) ring-(--chart)/25",
	past_due: "bg-(--down)/10 text-(--down) ring-(--down)/25",
	canceled: "bg-(--down)/10 text-(--down) ring-(--down)/25",
};

const STATUS_LABEL: Record<SubscriptionStatus, MessageKey> = {
	active: "billing.status.active",
	trialing: "billing.status.trialing",
	past_due: "billing.status.pastDue",
	canceled: "billing.status.canceled",
};

const StatusBadge = ({ status, label }: { status: string; label: string }) => (
	<span
		className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${
			STATUS_TONE[status] ?? "bg-muted/60 text-muted-foreground ring-foreground/10"
		}`}
	>
		{label}
	</span>
);

/** Smallest visible fill, so any usage above zero shows on the bar. */
const MIN_FILL_PCT = 2;

const UsageBar = ({
	label,
	level,
	used,
	limit,
}: {
	label: string;
	level: UsageLevel;
	used: number;
	limit: number;
}) => {
	const t = useT();
	const locale = useLocale();
	const nf = locale === "id" ? "id-ID" : "en-US";
	const raw = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
	const pct = used > 0 ? Math.max(MIN_FILL_PCT, raw) : 0;
	return (
		<div className="grid gap-1.5">
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span
					className={`tabular-nums ${level === "over" || level === "full" ? "text-(--down) font-medium" : "text-foreground"}`}
				>
					{t("billing.usageOf", {
						limit: limit.toLocaleString(nf),
						used: used.toLocaleString(nf),
					})}
				</span>
			</div>
			<div
				className="bg-muted h-1.5 overflow-hidden rounded-full"
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={limit}
				aria-valuenow={used}
			>
				<div
					className={`h-full rounded-full ${level === "over" || level === "full" ? "bg-(--down)" : "bg-(--chart)"}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
};

/* ---------------------------- subscription notice -------------------------- */

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

export interface SubscriptionNotice {
	/** Trial countdown is informational; every other kind is a warning. */
	warn: boolean;
	message: string;
	dismiss: () => void;
}

/**
 * The plan line for the account notice bar (AccountNotices). Null when the
 * subscription needs no attention or this kind was dismissed this session.
 */
export const useSubscriptionNotice = (): SubscriptionNotice | null => {
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
	let message: string;
	if (kind === "trial") {
		message = days > 0 ? t("banner.trial", { n: days }) : t("banner.trialToday");
	} else if (kind === "cancelling") {
		message = t("banner.cancelling", { date: formatDate(sub.current_period_end, locale) });
	} else {
		message = t(`banner.${kind}`);
	}
	return { dismiss, message, warn: kind !== "trial" };
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

/**
 * One plan. `recommended` (the plan picked on the pricing page, else the
 * trial plan) gets the accent ring, the filled pay button, first place on
 * phones and an open feature list; the rest stay quiet and fold their
 * feature lists on phones so the page does not run three cards deep.
 */
const PlanCard = ({
	plan,
	isCurrent,
	badge,
	recommended,
	highlighted,
	busy,
	onCard,
	onQris,
	qrisAvailable,
}: {
	plan: BillingPlan;
	isCurrent: boolean;
	badge: PlanBadge;
	recommended: boolean;
	highlighted: boolean;
	busy: boolean;
	onCard: (tier: PlanTier) => void;
	onQris: (tier: PlanTier) => void;
	qrisAvailable: boolean;
}) => {
	const t = useT();
	const ref = useRef<HTMLDivElement>(null);
	const [featuresOpen, setFeaturesOpen] = useState(false);
	const idr = plan.price_idr ?? IDR_PRICE[plan.tier];
	const usd = money(plan.price);
	const emphasis = recommended || isCurrent;
	const listId = `plan-features-${plan.tier}`;
	const primaryVariant = recommended ? "default" : "outline";

	useEffect(() => {
		if (highlighted) {
			ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
	}, [highlighted]);

	return (
		<div
			ref={ref}
			className={`flex flex-col rounded-lg p-4 ring-1 ${
				emphasis ? "bg-(--chart)/[0.06] ring-(--chart)/70" : "bg-card ring-foreground/10"
			} ${recommended ? "order-first md:order-none" : ""}`}
		>
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">{planLabel(plan.tier)}</h3>
				{badge && !isCurrent ? (
					<span className="bg-(--chart)/15 text-(--chart) rounded-md px-1.5 py-0.5 text-[11px] font-medium">
						{badge === "trial" ? t("billing.trialBadge") : t("billing.pickedBadge")}
					</span>
				) : null}
			</div>
			<div className="mt-2 flex items-baseline gap-1">
				<span className="text-3xl font-semibold tracking-tight tabular-nums">
					{qrisAvailable ? money(idr, "IDR") : usd}
				</span>
				<span className="text-muted-foreground text-xs">{t("billing.perMonth")}</span>
			</div>
			{qrisAvailable ? (
				<p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
					{t("billing.byCard", { price: usd })}
				</p>
			) : null}
			<p className="text-foreground/85 mt-3 text-xs tabular-nums">{t(PLAN_LIMIT_KEY[plan.tier])}</p>

			<div className="border-border mt-3 flex-1 border-t pt-3">
				{recommended ? null : (
					<button
						type="button"
						aria-expanded={featuresOpen}
						aria-controls={listId}
						onClick={() => setFeaturesOpen((open) => !open)}
						className="text-muted-foreground hover:text-foreground focus-visible:outline-ring -mx-1 -my-2 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 text-xs font-medium outline-offset-2 focus-visible:outline-2 md:hidden"
					>
						{t(PLAN_INCLUDES[plan.tier])}
						<span className="inline-flex items-center gap-1 font-normal">
							{featuresOpen ? t("billing.hideFeatures") : t("billing.showFeatures")}
							<ChevronDown
								className={`size-3.5 transition-transform duration-150 ease-out ${featuresOpen ? "rotate-180" : ""}`}
								aria-hidden
							/>
						</span>
					</button>
				)}
				<div id={listId} className={recommended || featuresOpen ? "block" : "hidden md:block"}>
					<p
						className={`text-muted-foreground mb-2 text-xs font-medium ${
							recommended ? "" : "hidden md:block"
						}`}
					>
						{t(PLAN_INCLUDES[plan.tier])}
					</p>
					<ul className="grid gap-1.5 pb-1">
						{PLAN_FEATURES[plan.tier].map((key) => (
							<li key={key} className="flex items-start gap-2 text-[13px]">
								<Check className="text-(--chart) mt-0.5 size-3.5 shrink-0" aria-hidden />
								{t(key)}
							</li>
						))}
					</ul>
				</div>
			</div>

			{isCurrent ? (
				<Button variant="outline" disabled className="mt-4 h-10 w-full text-[13px]">
					{t("billing.currentBtn")}
				</Button>
			) : (
				<div className="mt-4 grid gap-1">
					{qrisAvailable ? (
						<Button
							variant={primaryVariant}
							className="h-10 w-full text-[13px]"
							disabled={busy}
							onClick={() => onQris(plan.tier)}
						>
							<QrCode className="size-4" aria-hidden />
							{t("billing.payQris")}
						</Button>
					) : null}
					<Button
						variant={qrisAvailable ? "ghost" : primaryVariant}
						className={`w-full ${qrisAvailable ? "text-muted-foreground h-10 text-xs" : "h-10 text-[13px]"}`}
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
export const periodLine = (
	sub: BillingSubscription,
	t: ReturnType<typeof useT>,
	date: (iso: string) => string,
): string => {
	if (!sub.id) return t("billing.noPlan");
	const state = subscriptionState(sub);
	// Grandfathered plans never end; showing "1 Jan 10000" reads as a bug.
	if (state.paidActive && isOpenEnded(sub.current_period_end)) return t("billing.lifetime");
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
	localeToggle = true,
}: {
	/** Tier to emphasise, e.g. the one picked on the pricing page. */
	highlightPlan?: PlanTier;
	/** Set when a payment provider just sent the browser back. */
	checkout?: CheckoutResult;
	onCheckoutHandled?: () => void;
	/** False when the page header already carries the ID/EN toggle. */
	localeToggle?: boolean;
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
	const isQrisPlan = Boolean(
		sub?.id &&
			state?.paidActive &&
			!sub.polar_subscription_id &&
			!isOpenEnded(sub.current_period_end),
	);
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
	// One plan leads: the one picked on the pricing page, else the plan the
	// trial runs on ("keep what you have"). Paid accounts see no push.
	const recommendedTier: PlanTier | undefined =
		highlightPlan ?? (state?.trialing ? parsePlan(sub?.plan) : undefined);

	return (
		<main className="mx-auto max-w-7xl px-3 pt-4 pb-8 md:px-4">
			<div className="mb-3 flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold tracking-tight">{t("billing.title")}</h1>
					<p className="text-muted-foreground text-xs">{t("billing.subtitle")}</p>
				</div>
				{localeToggle ? <LocaleToggle className="shrink-0" /> : null}
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
					<div className="grid gap-4 pt-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-base font-semibold tracking-tight">
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
							<p className="text-sm font-medium tabular-nums">{periodLine(sub, t, date)}</p>
							{state.trialing && !state.trialEnded ? (
								<p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
									{t("billing.trialNote")}
								</p>
							) : null}
						</div>

						{sub.usage ? (
							<div className="grid gap-3">
								<div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
									<UsageBar
										label={t("billing.usageEvents")}
										level={usageLevel(sub.usage.events.used, sub.usage.events.limit)}
										used={sub.usage.events.used}
										limit={sub.usage.events.limit}
									/>
									<UsageBar
										label={t("billing.usageSites")}
										level={usageLevel(sub.usage.sites.used, sub.usage.sites.limit)}
										used={sub.usage.sites.used}
										limit={sub.usage.sites.limit}
									/>
								</div>
								{usageLevel(sub.usage.sites.used, sub.usage.sites.limit) === "over" ? (
									<p
										className="text-(--down) bg-(--down)/10 max-w-prose rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
										role="status"
									>
										{t("billing.overSites", {
											limit: sub.usage.sites.limit,
											plan: planLabel(sub.plan),
											used: sub.usage.sites.used,
										})}
									</p>
								) : null}
								{usageLevel(sub.usage.events.used, sub.usage.events.limit) === "full" ||
								usageLevel(sub.usage.events.used, sub.usage.events.limit) === "over" ? (
									<p
										className="text-(--down) bg-(--down)/10 max-w-prose rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
										role="status"
									>
										{t("billing.overEvents")}
									</p>
								) : null}
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
							<div className="grid gap-2.5 pt-1 md:grid-cols-3">
								{plans.map((plan) => (
									<PlanCard
										key={plan.tier}
										plan={plan}
										// A trial is never "current": the trial's own tier stays buyable.
										isCurrent={Boolean(sub?.id && state?.paidActive && sub.plan === plan.tier)}
										badge={badgeFor(plan.tier)}
										recommended={recommendedTier === plan.tier}
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

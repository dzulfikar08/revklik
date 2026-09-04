import { Button } from "@revklik-new/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clock,
  CreditCard,
  Info,
  QrCode,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  cancelSubscription,
  createCheckout,
  createPakasirCheckout,
  fetchPlans,
  fetchSubscription,
  verifyPakasirPayment,
} from "@/lib/legacy/billing";
import type {
  BillingPlan,
  BillingSubscription,
  PlanTier,
  SubscriptionStatus,
} from "@/lib/legacy/billing";

import { Panel } from "./ui";

/* ------------------------------- data hook -------------------------------- */

/**
 * Shared subscription query for the legacy klikapa billing API.
 * Import this from any panel that needs plan-aware behaviour.
 */
export const useSubscription = () =>
  useQuery({
    queryFn: fetchSubscription,
    queryKey: ["legacy", "subscription"],
    retry: false,
    staleTime: 60_000,
  });

/* ------------------------------- formatting ------------------------------- */

const PLAN_LABEL: Record<PlanTier, string> = {
  micro: "Micro",
  starter: "Starter",
  growth: "Growth",
};

/** Pakasir QRIS prices (IDR); card prices come from /billing/plans. */
const IDR_PRICE: Record<PlanTier, string> = {
  micro: "Rp 16.000",
  starter: "Rp 64.000",
  growth: "Rp 192.000",
};

const PLAN_LIMITS: Record<PlanTier, string> = {
  micro: "1 site · 10K events/mo",
  starter: "3 sites · 100K events/mo",
  growth: "10 sites · 500K events/mo",
};

const POPULAR_TIER: PlanTier = "starter";

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const STATUS_TONE: Record<SubscriptionStatus, string> = {
  active: "bg-(--up)/10 text-(--up) ring-(--up)/20",
  trialing: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  past_due: "bg-(--down)/10 text-(--down) ring-(--down)/20",
  canceled: "bg-(--down)/10 text-(--down) ring-(--down)/20",
};

const StatusBadge = ({ status }: { status: SubscriptionStatus }) => (
  <span
    className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] ring-1 capitalize ${
      STATUS_TONE[status] ?? "bg-muted/60 text-muted-foreground ring-foreground/10"
    }`}
  >
    {status.replace("_", " ")}
  </span>
);

const UsageBar = ({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) => {
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
        <div
          className="bg-(--chart) h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

/* ---------------------------- subscription banner -------------------------- */

type BannerKind = "trial" | "lapsed" | "cancelling" | "free";

const bannerKind = (sub: BillingSubscription): BannerKind | null => {
  if (sub.status === "trialing") return "trial";
  if (sub.status === "past_due" || sub.status === "canceled") return "lapsed";
  if (sub.cancel_at_period_end) return "cancelling";
  if (sub.plan === "micro" && sub.status === "active") return "free";
  return null;
};

const DISMISS_KEY = "kp_billing_banner_dismissed";

export const SubscriptionBanner = ({
  onUpgrade,
}: {
  onUpgrade: () => void;
}) => {
  const { data: sub } = useSubscription();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  if (!sub) return null;
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

  const days = sub.trial_days_remaining;
  const tone =
    kind === "lapsed" || kind === "cancelling"
      ? "bg-(--down)/10 text-(--down) ring-(--down)/20"
      : kind === "trial"
        ? "bg-(--up)/10 text-(--up) ring-(--up)/20"
        : "bg-muted/60 text-muted-foreground ring-foreground/10";
  const Icon =
    kind === "lapsed" || kind === "cancelling"
      ? AlertTriangle
      : kind === "trial"
        ? Clock
        : Info;

  return (
    <div
      className={`mb-2.5 flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-2 text-xs ring-1 ${tone}`}
      role="status"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {kind === "trial" ? (
          days !== null && days !== undefined && days > 0 ? (
            <>
              <strong className="font-semibold">
                {days} day{days === 1 ? "" : "s"} left
              </strong>{" "}
              on your free trial — upgrade to keep access after it ends.
            </>
          ) : (
            <>Your free trial has ended — choose a plan to continue.</>
          )
        ) : null}
        {kind === "lapsed" ? (
          <>
            Your subscription is {sub.status.replace("_", " ")} — choose a plan
            to restore full access.
          </>
        ) : null}
        {kind === "cancelling" ? (
          <>
            Subscription ends {fmtDate(sub.current_period_end)} — choose a plan
            to keep access.
          </>
        ) : null}
        {kind === "free" ? (
          <>
            You&rsquo;re on the free Micro plan ({PLAN_LIMITS.micro}) — upgrade
            for more sites and events.
          </>
        ) : null}
      </p>
      <Button size="xs" onClick={onUpgrade}>
        Upgrade
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="hover:text-foreground -mx-1 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
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
}

const PlanCard = ({
  plan,
  isCurrent,
  busy,
  onCard,
  onQris,
}: {
  plan: BillingPlan;
  isCurrent: boolean;
  busy: boolean;
  onCard: (tier: PlanTier) => void;
  onQris: (tier: PlanTier) => void;
}) => {
  const popular = plan.tier === POPULAR_TIER;
  return (
    <div
      className={`relative flex flex-col rounded-xl bg-card p-4 ring-1 ${
        isCurrent
          ? "bg-(--chart)/5 ring-(--chart)"
          : popular
            ? "ring-(--chart)/40"
            : "ring-foreground/10"
      }`}
    >
      {popular && !isCurrent ? (
        <span className="bg-(--chart) text-background absolute -top-2 right-3 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] uppercase">
          Popular
        </span>
      ) : null}
      <div className="text-muted-foreground font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
        {PLAN_LABEL[plan.tier]}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight">
          ${plan.price}
        </span>
        <span className="text-muted-foreground text-xs">/mo</span>
      </div>
      <div className="text-(--money) mt-0.5 text-xs">
        {IDR_PRICE[plan.tier]} via QRIS
      </div>
      <div className="text-muted-foreground mt-0.5 text-[11px]">
        {PLAN_LIMITS[plan.tier]}
      </div>
      <ul className="mt-3 mb-4 flex-1 space-y-1">
        {plan.features.map((f) => (
          <li
            key={f}
            className="text-muted-foreground flex items-center gap-2 text-xs"
          >
            <Check className="text-(--chart) size-3 shrink-0" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <Button variant="outline" size="sm" disabled className="w-full">
          Current plan
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => onCard(plan.tier)}
          >
            <CreditCard className="size-3.5" aria-hidden />
            Pay with card
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => onQris(plan.tier)}
          >
            <QrCode className="size-3.5" aria-hidden />
            Pay with QRIS
          </Button>
        </div>
      )}
    </div>
  );
};

export const BillingView = () => {
  const qc = useQueryClient();
  const subQ = useSubscription();
  const plansQ = useQuery({
    queryFn: fetchPlans,
    queryKey: ["legacy", "plans"],
    retry: false,
    staleTime: 300_000,
  });

  const sub = subQ.data;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingQris, setPendingQris] = useState<PendingQris | null>(null);


  const checkoutMut = useMutation({
    mutationFn: createCheckout,
    onError: (err) => toast.error(err.message),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const pakasirMut = useMutation({
    mutationFn: createPakasirCheckout,
    onError: (err) => toast.error(err.message),
    onSuccess: (data) => {
      setPendingQris({
        orderId: data.order_id,
        plan: data.plan,
        url: data.url,
      });
      window.open(data.url, "_blank", "noopener");
      toast.info(
        "QRIS payment page opened in a new tab — complete the payment, then verify here."
      );
    },
  });

  const verifyMut = useMutation({
    mutationFn: verifyPakasirPayment,
    onError: (err) => toast.error(err.message),
    onSuccess: (res) => {
      if (res.status === "active") {
        setPendingQris(null);
        toast.success("Pembayaran berhasil — paket Anda aktif.");
      } else {
        toast.info("Pembayaran masih diproses. Coba lagi beberapa saat.");
      }
      qc.invalidateQueries({ queryKey: ["legacy", "subscription"] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: cancelSubscription,
    onError: (err) => toast.error(err.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["legacy", "subscription"] });
      toast.success("Subscription will cancel at period end.");
    },
  });

  const plans = plansQ.data ?? [];
  const busy = checkoutMut.isPending || pakasirMut.isPending;
  const isPaid = sub ? sub.plan !== "micro" : false;
  const isActive = sub
    ? sub.status === "active" || sub.status === "trialing"
    : false;
  const canCancel = Boolean(
    sub && isPaid && isActive && !sub.cancel_at_period_end
  );

  return (
    <main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
      <div className="mb-2.5">
        <h1 className="text-lg font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-xs">
          Plans, payment and subscription for your revklik account
        </p>
      </div>

      {pendingQris ? (
        <section className="bg-card ring-(--chart)/40 mb-2.5 flex flex-wrap items-center gap-3 rounded-2xl p-3 ring-1">
          <div className="bg-(--chart)/10 text-(--chart) flex size-9 shrink-0 items-center justify-center rounded-xl">
            <QrCode className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">
              Complete your QRIS payment
              {pendingQris.plan in PLAN_LABEL
                ? ` — ${PLAN_LABEL[pendingQris.plan as PlanTier]}`
                : ""}
            </p>
            <p className="text-muted-foreground truncate font-mono text-[11px]">
              order {pendingQris.orderId} · opened in a new tab
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(pendingQris.url, "_blank", "noopener")}
          >
            Reopen tab
          </Button>
          <Button
            size="sm"
            disabled={verifyMut.isPending}
            onClick={() => verifyMut.mutate()}
          >
            {verifyMut.isPending ? "Verifying…" : "I've paid — verify"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={() => setPendingQris(null)}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </section>
      ) : null}

      <Panel title="Current plan">
        {subQ.isLoading ? (
          <p className="text-muted-foreground py-4 text-center text-xs">
            Loading subscription…
          </p>
        ) : subQ.error || !sub ? (
          <p className="text-(--down) py-4 text-center text-xs">
            {subQ.error instanceof Error
              ? subQ.error.message
              : "Unable to load subscription"}
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[15px] font-medium">
                {PLAN_LABEL[sub.plan]} Plan
              </span>
              <StatusBadge status={sub.status} />
              {sub.cancel_at_period_end ? (
                <span className="text-(--down) text-[11px]">
                  Cancels {fmtDate(sub.current_period_end)}
                </span>
              ) : null}
              {sub.status === "trialing" &&
              sub.trial_days_remaining !== null &&
              sub.trial_days_remaining !== undefined ? (
                <span className="text-sky-300 text-[11px]">
                  {sub.trial_days_remaining} day
                  {sub.trial_days_remaining === 1 ? "" : "s"} of trial remaining
                </span>
              ) : null}
            </div>

            <p className="text-muted-foreground font-mono text-xs">
              {isPaid ? (
                sub.cancel_at_period_end ? (
                  <>Access until {fmtDate(sub.current_period_end)}</>
                ) : (
                  <>Renews on {fmtDate(sub.current_period_end)}</>
                )
              ) : (
                <>Free plan · {PLAN_LIMITS[sub.plan]}</>
              )}
            </p>

            {sub.usage ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <UsageBar
                  label="Events this month"
                  used={sub.usage.events.used}
                  limit={sub.usage.events.limit}
                />
                <UsageBar
                  label="Sites"
                  used={sub.usage.sites.used}
                  limit={sub.usage.sites.limit}
                />
              </div>
            ) : null}

            {canCancel ? (
              confirmCancel ? (
                <div className="flex items-center gap-2.5">
                  <span className="text-muted-foreground text-xs">
                    Cancel subscription? It stays active until{" "}
                    {fmtDate(sub.current_period_end)}.
                  </span>
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={cancelMut.isPending}
                    onClick={() => cancelMut.mutate()}
                  >
                    {cancelMut.isPending ? "Cancelling…" : "Yes, cancel"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setConfirmCancel(false)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <div>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setConfirmCancel(true)}
                  >
                    Cancel subscription
                  </Button>
                </div>
              )
            ) : null}
          </div>
        )}
      </Panel>

      <div className="mt-2.5">
        <Panel title="Plans" hint="monthly · cancel anytime">
          {plansQ.isLoading ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              Loading plans…
            </p>
          ) : plansQ.error ? (
            <p className="text-(--down) py-4 text-center text-xs">
              {plansQ.error instanceof Error
                ? plansQ.error.message
                : "Unable to load plans"}
            </p>
          ) : (
            <div className="grid gap-2.5 md:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.tier}
                  plan={plan}
                  isCurrent={sub?.plan === plan.tier && isActive}
                  busy={busy}
                  onCard={(tier) => checkoutMut.mutate(tier)}
                  onQris={(tier) => pakasirMut.mutate(tier)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
};

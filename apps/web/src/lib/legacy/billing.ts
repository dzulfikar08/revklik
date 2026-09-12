/**
 * Legacy klikapa billing endpoints (GET/POST /billing/*) on the production
 * revklik Worker. Deliberately isolated from better-auth's Polar client —
 * this module talks to the klikapa billing routes only.
 */
import { legacyFetch } from "./api";

export type PlanTier = "micro" | "starter" | "growth";

export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing";

export interface BillingUsage {
  events: { used: number; limit: number };
  sites: { used: number; limit: number };
}

export interface BillingSubscription {
  id: string;
  user_id: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  polar_subscription_id: string | null;
  polar_customer_id: string | null;
  usage?: BillingUsage;
  trial_days_remaining?: number | null;
}

export interface BillingPlan {
  tier: PlanTier;
  name: string;
  price: number;
  events_per_month: number;
  sites: number;
  features: string[];
  checkout_url: string | null;
}

export interface BillingAlerts {
  weekly_report: boolean;
  milestone_alerts: boolean;
  conversion_alerts: boolean;
}

export const fetchSubscription = (): Promise<BillingSubscription> =>
  legacyFetch("/billing/subscription");

export interface PlansResponse {
  plans: BillingPlan[];
  /** QRIS only works with Indonesian payment apps — hidden elsewhere. */
  qris_available: boolean;
}

export const fetchPlans = (): Promise<PlansResponse> =>
  legacyFetch("/billing/plans");

/** Polar card checkout — returns the hosted checkout URL to redirect to. */
export const createCheckout = (plan: PlanTier): Promise<{ url: string }> =>
  legacyFetch("/billing/checkout", {
    body: JSON.stringify({ plan }),
    method: "POST",
  });

/** Pakasir QRIS checkout — returns the payment-page URL plus order details. */
export const createPakasirCheckout = (
  plan: PlanTier
): Promise<{ url: string; order_id: string; amount: number; plan: string }> =>
  legacyFetch("/billing/checkout/pakasir", {
    body: JSON.stringify({ plan }),
    method: "POST",
  });

/**
 * Safety net after the user returns from the QRIS page — re-checks the
 * pending Pakasir order with the transaction API in case the webhook lagged.
 */
export const verifyPakasirPayment = (): Promise<{
  status: "active" | "pending" | "no_pending_order";
  plan?: string;
}> => legacyFetch("/billing/pakasir/verify", { method: "POST" });

export const cancelSubscription = (): Promise<void> =>
  legacyFetch("/billing/cancel", { method: "POST" });

export const fetchBillingAlerts = (): Promise<BillingAlerts> =>
  legacyFetch("/billing/alerts");

export const updateBillingAlerts = (
  prefs: BillingAlerts
): Promise<BillingAlerts> =>
  legacyFetch("/billing/alerts", {
    body: JSON.stringify(prefs),
    method: "POST",
  });

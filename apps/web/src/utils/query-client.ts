import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { openBilling } from "@/lib/billing-nav";
import { t } from "@/lib/i18n";
import { isPlanRequired, isSubscriptionInactive, LegacyApiError } from "@/lib/legacy/api";
import { parsePlan, planLabel } from "@/lib/legacy/billing";
import { GrowthPlanLockedError } from "@/lib/legacy/growth";
import { onSessionExpired } from "@/lib/session-nav";

const isUnauthorized = (error: unknown): boolean =>
	error instanceof LegacyApiError && error.status === 401;

/** One id so repeated plan errors update a single toast instead of stacking. */
export const PLAN_TOAST_ID = "plan-required";

/**
 * Toast for a 403 plan error with an Upgrade action that opens billing.
 * Returns false when `error` is not a plan error.
 */
export const notifyPlanRequired = (error: unknown): boolean => {
	if (!isPlanRequired(error)) {
		return false;
	}
	const plan = parsePlan(error.body?.required_plan);
	const message = error.body?.quota
		? t("sites.limit")
		: t("upgrade.planRequired", { plan: planLabel(plan ?? "growth") });
	toast.error(message, {
		action: { label: t("upgrade.action"), onClick: () => openBilling(plan) },
		id: PLAN_TOAST_ID,
	});
	return true;
};

export function createQueryClient() {
	return new QueryClient({
		mutationCache: new MutationCache({
			// Mutations toast their own errors; plan errors get the upgrade toast
			// here so no call site has to special-case them.
			onError: (error) => {
				if (isUnauthorized(error)) {
					onSessionExpired();
					return;
				}
				notifyPlanRequired(error);
			},
		}),
		queryCache: new QueryCache({
			onError: (error, query) => {
				// Mid-session 401: back to sign-in (and here afterwards), no toast.
				if (isUnauthorized(error)) {
					onSessionExpired();
					return;
				}
				// Queries that render their own inline degraded state opt out
				// via `meta: { silent: true }`.
				if (query.meta?.silent) {
					return;
				}
				// A lapsed account gets the full-panel upgrade lock, and
				// Growth-only panels render their own lock, so neither toasts.
				if (isSubscriptionInactive(error) || error instanceof GrowthPlanLockedError) {
					return;
				}
				if (notifyPlanRequired(error)) {
					return;
				}
				toast.error(`Error: ${error.message}`, {
					action: {
						label: "retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
	});
}

export const queryClient = createQueryClient();

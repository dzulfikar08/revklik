/**
 * "Upgrade" from anywhere (toasts fired by the query cache, locked panels,
 * the add-site form) without importing the router into every module.
 * main.tsx registers the real navigation once the router exists.
 */
import type { PlanTier } from "./legacy/billing";

type BillingOpener = (plan?: PlanTier) => void;

let opener: BillingOpener = () => {
	window.location.assign("/analytics/billing");
};

export const registerBillingOpener = (fn: BillingOpener): void => {
	opener = fn;
};

export const openBilling = (plan?: PlanTier): void => {
	opener(plan);
};

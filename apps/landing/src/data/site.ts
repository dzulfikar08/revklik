import { C } from './copy';

// Canonical tracker URL, served by the app worker, NOT the landing domain.
// (https://revklik.com/klikapa.js returns the SPA HTML fallback and browsers
// refuse to execute it due to nosniff. Never use it in copy.)
export const TRACKER_URL = 'https://app.revklik.com/klikapa.js';
export const LOGIN_URL = 'https://app.revklik.com';
export const REGISTER_URL = 'https://app.revklik.com/register';
export const SUPPORT_EMAIL = 'support@revklik.com';

export type Plan = {
	id: 'micro' | 'starter' | 'growth';
	name: string;
	// IDR price. Must match PAKASIR_PRICES in the app worker.
	amount: number;
	label: string;
	events: number;
	desc: string;
	features: readonly string[];
	// Starter is the first tier with revenue attribution, the product's core
	// feature, so it is the one row that gets emphasis.
	highlight?: boolean;
};

export const PLANS: Plan[] = [
	{ id: 'micro', name: 'Micro', amount: 16_000, label: 'Rp 16.000', events: 10_000, desc: C.p0_desc, features: C.p0_f },
	{ id: 'starter', name: 'Starter', amount: 64_000, label: 'Rp 64.000', events: 100_000, desc: C.p1_desc, features: C.p1_f, highlight: true },
	{ id: 'growth', name: 'Growth', amount: 192_000, label: 'Rp 192.000', events: 500_000, desc: C.p2_desc, features: C.p2_f },
];

// Pricing CTAs send the visitor to signup with the plan preselected. Every new
// account starts a 7-day Growth trial; the app paywall handles the QRIS payment
// via Pakasir afterwards (the webhook needs a user account to attribute to).
export function registerUrl(plan: Plan): string {
	return `${REGISTER_URL}?plan=${plan.id}`;
}

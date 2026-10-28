// Canonical tracker URL — served by the app worker, NOT the landing domain.
// (https://revklik.com/klikapa.js returns the SPA HTML fallback and browsers
// refuse to execute it due to nosniff — never use it in copy.)
export const TRACKER_URL = 'https://app.revklik.com/klikapa.js';
export const LOGIN_URL = 'https://app.revklik.com';
export const REGISTER_URL = 'https://app.revklik.com/register';
export const SUPPORT_EMAIL = 'support@revklik.com';

export type Plan = {
	id: 'micro' | 'starter' | 'growth';
	name: string;
	// IDR price — must match PAKASIR_PRICES in the app worker.
	amount: number;
	label: string;
	events: number;
	featKeys: string[];
	ctaKey: string;
	descKey: string;
	popular?: boolean;
};

export const PLANS: Plan[] = [
	{ id: 'micro', name: 'Micro', amount: 16_000, label: 'Rp 16.000', events: 10_000, featKeys: ['p0_f1', 'p0_f2', 'p0_f3', 'p0_f4', 'p0_f5'], ctaKey: 'p0_cta', descKey: 'p0_desc' },
	{ id: 'starter', name: 'Starter', amount: 64_000, label: 'Rp 64.000', events: 100_000, featKeys: ['p1_f1', 'p1_f2', 'p1_f3', 'p1_f4', 'p1_f5'], ctaKey: 'p1_cta', descKey: 'p1_desc', popular: true },
	{ id: 'growth', name: 'Growth', amount: 192_000, label: 'Rp 192.000', events: 500_000, featKeys: ['p2_f1', 'p2_f2', 'p2_f3', 'p2_f4'], ctaKey: 'p2_cta', descKey: 'p2_desc' },
];

// Pricing CTAs send the visitor to signup with the plan preselected. Every new
// account starts a 7-day Growth trial; the app paywall handles the QRIS payment
// via Pakasir afterwards (the webhook needs a user account to attribute to).
export function registerUrl(plan: Plan): string {
	return `${REGISTER_URL}?plan=${plan.id}`;
}

import catalog from '../../../../packages/shared/marketing/catalog.json';
import type { Copy } from './copy';

// Canonical tracker URL, served by the app worker, NOT the landing domain.
// (revklik.com/klikapa.js only redirects here for old snippets. Never use it in copy.)
export const TRACKER_URL = 'https://app.revklik.com/klikapa.js';
export const LOGIN_URL = 'https://app.revklik.com';
export const REGISTER_URL = 'https://app.revklik.com/register';
export const SUPPORT_EMAIL = 'support@revklik.com';
export const DOCS_URL = 'https://docs.revklik.com';

/** Docs home in the reader's language (`/id/` is the Bahasa Indonesia tree). */
export function docsUrl(locale: 'id' | 'en'): string {
	return locale === 'id' ? `${DOCS_URL}/id/` : `${DOCS_URL}/`;
}

/** App links carry the page language so sign-up continues in it (app reads `?lang=`). */
export function appLink(url: string, lang: string, utm?: { source: string; campaign: string }): string {
	const u = new URL(url);
	u.searchParams.set('lang', lang);
	if (utm) {
		u.searchParams.set('utm_source', utm.source);
		u.searchParams.set('utm_medium', 'content');
		u.searchParams.set('utm_campaign', utm.campaign);
	}
	return u.toString();
}

export type Plan = {
	id: 'micro' | 'starter' | 'growth';
	name: string;
	// IDR price. Must match PAKASIR_PRICES in the app worker.
	amount: number;
	/** Headline price in the reader's currency: Rupiah on the ID page, USD on EN. */
	label: string;
	/** The other currency, shown small under the price. */
	altLabel: string;
	events: number;
	desc: string;
	features: readonly string[];
	// Starter is the first tier with revenue attribution, the product's core
	// feature, so it is the one row that gets emphasis.
	highlight?: boolean;
};

function rp(amount: number, c: Copy): string {
	return `Rp ${amount.toLocaleString(c.lang === 'en' ? 'en-US' : 'id-ID')}`;
}

function usd(amount: number): string {
	return `$${amount}`;
}

export function getPlans(c: Copy): Plan[] {
	const [micro, starter, growth] = catalog.plans;
	const text = [
		{ desc: c.p0_desc, features: c.p0_f },
		{ desc: c.p1_desc, features: c.p1_f },
		{ desc: c.p2_desc, features: c.p2_f },
	];
	const en = c.lang === 'en';
	return [micro, starter, growth].map((p, i) => ({
		id: p.id as Plan['id'],
		name: p.name,
		amount: p.idr,
		label: en ? usd(p.usd) : rp(p.idr, c),
		altLabel: en
			? `${c.price_alt_prefix} ${rp(p.idr, c)} ${c.price_alt_suffix}`
			: `${c.price_alt_prefix} ${usd(p.usd)} ${c.price_alt_suffix}`,
		events: p.events,
		desc: text[i].desc,
		features: text[i].features,
		highlight: p.id === 'starter',
	}));
}

// Pricing CTAs send the visitor to signup with the plan preselected. Every new
// account starts a 7-day Growth trial; the app paywall handles payment
// afterwards (QRIS via Pakasir, or card via Polar), so `plan` is intent only.
export function registerUrl(plan: Plan): string {
	return `${REGISTER_URL}?plan=${plan.id}`;
}

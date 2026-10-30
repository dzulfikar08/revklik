import type { Locale } from './copy';

export const ORIGIN = 'https://revklik.com';
/** Share card used when a page has no card of its own (generated in src/pages/og). */
export const defaultOgImage = (locale: Locale): string => `${ORIGIN}/og/home/${locale}.png`;

/**
 * Canonical public URL for a site path. Cloudflare Pages serves `x.html` at
 * `/x` and `dir/index.html` at `/dir/`, so the only trailing-slash paths are
 * the two locale homes (`/` and `/en/`). Everything else is extensionless
 * with no trailing slash, and this is the one place that shape is decided.
 */
export function pageUrl(path: string): string {
	return `${ORIGIN}${path}`;
}

/** Path of a page in the given locale. `id` lives at the root, `en` under `/en`. */
export function localePath(locale: Locale, path: string): string {
	if (locale === 'id') return path;
	return path === '/' ? '/en/' : `/en${path}`;
}

export type Alternates = Partial<Record<Locale, string>>;

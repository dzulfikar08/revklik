/** Origin of the hosted RevKlik app; the default when APP_URL is not set. */
export const DEFAULT_APP_URL = "https://app.revklik.com";

/** Public origin of this deployment (no trailing slash): APP_URL, else the hosted default. */
export function appUrl(env: { APP_URL?: string } | undefined): string {
	const raw = env?.APP_URL?.trim();
	return raw ? raw.replace(/\/+$/, "") : DEFAULT_APP_URL;
}

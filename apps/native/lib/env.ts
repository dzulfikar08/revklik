/**
 * Build-time configuration. Expo inlines `process.env.EXPO_PUBLIC_*` reads
 * that are written out literally, so each variable is read by name here.
 */
import { z } from "zod";

const DEFAULT_API_URL = "https://app.revklik.com/api";

const parsedApiUrl = z
	.url()
	.safeParse(process.env.EXPO_PUBLIC_REVKLIK_API_URL?.trim() || DEFAULT_API_URL);

if (!parsedApiUrl.success) {
	throw new Error(
		"EXPO_PUBLIC_REVKLIK_API_URL must be an absolute URL, e.g. https://app.revklik.com/api",
	);
}

/** RevKlik Worker API base (no trailing slash). */
export const API_URL: string = parsedApiUrl.data.replace(/\/+$/u, "");

/** Web origin derived from the API base; used for "manage on the web" links. */
export const WEB_URL: string = new URL(API_URL).origin;

/**
 * Dev-only escape hatch: inject an existing `kp_`/`rv_` session token instead
 * of signing in. Compiled out of production builds because `__DEV__` is false.
 */
export const DEV_TOKEN: string | undefined = __DEV__
	? process.env.EXPO_PUBLIC_REVKLIK_DEV_TOKEN?.trim() || undefined
	: undefined;

/** The hosted product's API origin; only it has a RevKlik Books client registered. */
const HOSTED_ORIGIN = "https://app.revklik.com";
const HOSTED_BOOKS_URL = "https://books.revklik.com";

/** Path on Books that starts "Masuk dengan RevKlik" (OAuth against this app's /oauth/authorize). */
const BOOKS_SIGN_IN_PATH = "/auth/revklik/start";

const booksBase = (): string => {
	const configured = process.env.EXPO_PUBLIC_REVKLIK_BOOKS_URL?.trim();
	if (configured) {
		return configured;
	}
	return WEB_URL === HOSTED_ORIGIN ? HOSTED_BOOKS_URL : "";
};

/**
 * Link target of the account section's "RevKlik Books" row, same destination as
 * the web account menu. Null on a self-hosted install (no Books client registered)
 * unless EXPO_PUBLIC_REVKLIK_BOOKS_URL points at one.
 */
export const BOOKS_URL: string | null = ((): string | null => {
	const base = booksBase();
	return base ? `${base.replace(/\/+$/u, "")}${BOOKS_SIGN_IN_PATH}` : null;
})();

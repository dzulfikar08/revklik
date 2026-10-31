import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Bindings } from "../types";
import { hashToken } from "../utils";
import { timingSafeEqual } from "./webhook-utils";

/**
 * RevKlik as an OAuth 2.0 provider for one first-party client, RevKlik Books:
 * authorization code + PKCE (S256), no consent screen, identity only. The code
 * exchange answers who signed in; no access or refresh token exists.
 */

type Db = Kysely<KlikapaDatabase>;
type OAuthEnv = Pick<Bindings, "BOOKS_OAUTH_CLIENT_SECRET" | "BOOKS_OAUTH_REDIRECT_URIS">;

export const BOOKS_CLIENT_ID = "revklik-books";
/** A code is exchanged by Books' server right after the redirect: a minute is plenty. */
export const CODE_TTL_MS = 60_000;

const MAX_STATE_LENGTH = 512;
const CODE_BYTES = 32;
/** base64url of a SHA-256 digest: always 43 characters. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 section 4.1: 43 to 128 unreserved characters. */
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

/** PKCE S256 transform of a code verifier. */
export async function s256Challenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return toBase64Url(new Uint8Array(digest));
}

function allowedRedirectUris(env: OAuthEnv): string[] {
	return (env.BOOKS_OAUTH_REDIRECT_URIS ?? "")
		.split(",")
		.map((uri) => uri.trim())
		.filter(Boolean);
}

export interface AuthorizeRequest {
	redirectUri: string;
	state: string;
	codeChallenge: string;
}

export type AuthorizeCheck =
	| { ok: true; request: AuthorizeRequest }
	/** Unknown client or redirect URI: show an error page, NEVER redirect (RFC 6749 section 4.1.2.1). */
	| { ok: false; page: "client" | "redirect" }
	/** Any other problem goes back to the (validated) redirect URI as an error response. */
	| { ok: false; redirectTo: string };

/** One value for a parameter, "" when absent, null when it is repeated (RFC 6749 section 3.1). */
function single(params: URLSearchParams, name: string): string | null {
	const values = params.getAll(name);
	if (values.length > 1) return null;
	return values[0] ?? "";
}

function errorRedirect(
	redirectUri: string,
	state: string | null,
	error: string,
	description: string,
): string {
	const url = new URL(redirectUri);
	url.searchParams.set("error", error);
	url.searchParams.set("error_description", description);
	if (state && state.length <= MAX_STATE_LENGTH) url.searchParams.set("state", state);
	return url.toString();
}

/** Validate an /oauth/authorize request against the client registration. */
export function checkAuthorizeRequest(env: OAuthEnv, params: URLSearchParams): AuthorizeCheck {
	if (!env.BOOKS_OAUTH_CLIENT_SECRET || single(params, "client_id") !== BOOKS_CLIENT_ID) {
		return { ok: false, page: "client" };
	}
	const redirectUri = single(params, "redirect_uri");
	if (!redirectUri || !allowedRedirectUris(env).includes(redirectUri)) {
		return { ok: false, page: "redirect" };
	}

	const state = single(params, "state");
	const fail = (error: string, description: string): AuthorizeCheck => ({
		ok: false,
		redirectTo: errorRedirect(redirectUri, state, error, description),
	});
	if (!state || state.length > MAX_STATE_LENGTH) {
		return fail("invalid_request", "state is required (at most 512 characters)");
	}
	if (single(params, "response_type") !== "code") {
		return fail("unsupported_response_type", "response_type must be code");
	}
	const codeChallenge = single(params, "code_challenge");
	if (
		single(params, "code_challenge_method") !== "S256" ||
		!CHALLENGE_PATTERN.test(codeChallenge ?? "")
	) {
		return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
	}
	return { ok: true, request: { redirectUri, state, codeChallenge: codeChallenge ?? "" } };
}

/** Mint a single-use code for `userId`; the redirect carries it, only its hash is stored. */
export async function issueAuthorizationCode(
	db: Db,
	userId: string,
	request: AuthorizeRequest,
	now = Date.now(),
): Promise<string> {
	const bytes = new Uint8Array(CODE_BYTES);
	crypto.getRandomValues(bytes);
	const code = toBase64Url(bytes);
	await db
		.deleteFrom("oauth_codes")
		.where("expires_at", "<", new Date(now).toISOString())
		.execute();
	await db
		.insertInto("oauth_codes")
		.values({
			code_hash: await hashToken(code),
			client_id: BOOKS_CLIENT_ID,
			redirect_uri: request.redirectUri,
			code_challenge: request.codeChallenge,
			user_id: userId,
			expires_at: new Date(now + CODE_TTL_MS).toISOString(),
		})
		.execute();
	return code;
}

/** The redirect URI with `code` and `state` appended. */
export function successRedirect(request: AuthorizeRequest, code: string): string {
	const url = new URL(request.redirectUri);
	url.searchParams.set("code", code);
	url.searchParams.set("state", request.state);
	return url.toString();
}

export type TokenError = "invalid_request" | "invalid_client" | "invalid_grant";

export interface SsoIdentity {
	sub: string;
	email: string;
	email_verified: boolean;
	name: string;
}

export type CodeExchange = { ok: true; identity: SsoIdentity } | { ok: false; error: TokenError };

/** Equal-length digests make the comparison independent of where the secrets differ. */
async function secretMatches(provided: string, expected: string): Promise<boolean> {
	return timingSafeEqual(await hashToken(provided), await hashToken(expected));
}

/**
 * Redeem an authorization code. The client is authenticated before the code is
 * touched; the code is then consumed in a single DELETE, so a replay, a race and
 * a failed redirect/PKCE check all leave it unusable.
 */
export async function exchangeAuthorizationCode(
	db: Db,
	env: OAuthEnv,
	form: URLSearchParams,
	now = Date.now(),
): Promise<CodeExchange> {
	const grantType = single(form, "grant_type");
	const code = single(form, "code");
	const redirectUri = single(form, "redirect_uri");
	const clientId = single(form, "client_id");
	const clientSecret = single(form, "client_secret");
	const codeVerifier = single(form, "code_verifier");
	if (
		grantType !== "authorization_code" ||
		!code ||
		!redirectUri ||
		!clientId ||
		!clientSecret ||
		!codeVerifier ||
		!VERIFIER_PATTERN.test(codeVerifier)
	) {
		return { ok: false, error: "invalid_request" };
	}

	const expectedSecret = env.BOOKS_OAUTH_CLIENT_SECRET;
	if (
		!expectedSecret ||
		clientId !== BOOKS_CLIENT_ID ||
		!(await secretMatches(clientSecret, expectedSecret))
	) {
		return { ok: false, error: "invalid_client" };
	}

	const row = await db
		.deleteFrom("oauth_codes")
		.where("code_hash", "=", await hashToken(code))
		.returning(["client_id", "redirect_uri", "code_challenge", "user_id", "expires_at"])
		.executeTakeFirst();
	if (
		!row ||
		new Date(row.expires_at).getTime() <= now ||
		row.client_id !== clientId ||
		row.redirect_uri !== redirectUri ||
		!timingSafeEqual(await s256Challenge(codeVerifier), row.code_challenge)
	) {
		return { ok: false, error: "invalid_grant" };
	}

	const user = await db
		.selectFrom("users")
		.select(["id", "email", "name", "email_verified_at"])
		.where("id", "=", row.user_id)
		.executeTakeFirst();
	if (!user) return { ok: false, error: "invalid_grant" };
	return {
		ok: true,
		identity: {
			sub: user.id,
			email: user.email,
			email_verified: Boolean(user.email_verified_at),
			name: user.name,
		},
	};
}

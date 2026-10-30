import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { checkSiteAccess } from "./site-access";
import type { SiteAction } from "./site-roles";
import { hashToken } from "../utils";

export type TokenAuthResult =
	| { ok: true; userId: string; tokenType: "account" | "site" }
	| { ok: false; status: 401 | 403 | 404; error: string };

const deny = (status: 401 | 403 | 404, error: string): TokenAuthResult => ({
	ok: false,
	status,
	error,
});

/**
 * Authenticate an API token (rvt_ account or rv_ site) for one site: the token must be
 * live, hold `scope`, match its site binding, and its owner must hold `action` on the site.
 * For routes outside /v1 that take a raw token (query param or body) rather than the
 * public-auth middleware. Session (kp_) tokens are refused: they are not API credentials.
 */
export async function authenticateApiToken(
	db: Kysely<KlikapaDatabase>,
	token: string,
	check: { scope: string; siteId: string; action: SiteAction },
): Promise<TokenAuthResult> {
	const row = await db
		.selectFrom("api_keys")
		.select(["user_id", "token_type", "scopes", "site_id", "expires_at"])
		.where("key_hash", "=", await hashToken(token))
		.executeTakeFirst();
	if (!row) return deny(401, "Invalid token");
	if (row.token_type !== "account" && row.token_type !== "site") {
		return deny(401, "Use an API token (rvt_ or rv_), not a session token");
	}
	if (row.expires_at && new Date(row.expires_at) <= new Date()) return deny(401, "Token expired");

	let scopes: string[] = [];
	try {
		scopes = row.scopes ? JSON.parse(row.scopes) : [];
	} catch {
		scopes = [];
	}
	if (!scopes.includes(check.scope)) return deny(403, `Insufficient scope: ${check.scope} required`);
	if (row.site_id && row.site_id !== check.siteId) {
		return deny(403, "Token not valid for this site");
	}

	const { denied } = await checkSiteAccess(db, row.user_id, check.siteId, check.action);
	if (denied) return deny(denied.status, denied.error);
	return { ok: true, userId: row.user_id, tokenType: row.token_type };
}

/** The token from an `Authorization: Bearer …` header, or undefined. */
export function bearerToken(header: string | undefined): string | undefined {
	return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

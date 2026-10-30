import type { Kysely } from "kysely";
import type { CreateTokenResponse, KlikapaDatabase, TokenInfo } from "@revklik/shared";
import { DEFAULT_ACCOUNT_SCOPES, DEFAULT_SITE_SCOPES, SCOPES } from "@revklik/shared";
import { isSelfHosted } from "./entitlement";
import { checkSiteAccess } from "./site-access";
import { generateApiKey, generateId, hashToken } from "../utils";

const PLAN_TOKEN_LIMITS: Record<string, number> = {
	free: 2,
	starter: 5,
	growth: Infinity,
};

/** A site-bound token can read analytics and report server events, nothing else. */
const SITE_TOKEN_SCOPES: readonly string[] = [
	SCOPES.ANALYTICS_READ,
	SCOPES.ANALYTICS_EXPORT,
	SCOPES.EVENTS_WRITE,
];

export interface TokenCaller {
	userId: string;
	/**
	 * Set when an API token is minting the new token: the new token may never exceed it.
	 * Absent for a signed-in dashboard session, which acts as the user.
	 */
	via?: { scopes: string[]; type: "account" | "site" };
}

export interface CreateTokenInput {
	name?: unknown;
	type?: unknown;
	scopes?: unknown;
	site_id?: unknown;
}

export type TokenResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 403 | 404; error: string };

const fail = (status: 400 | 403 | 404, error: string): TokenResult<never> => ({
	ok: false,
	status,
	error,
});

/** Scopes this token may be asked for, or an error message. */
function resolveScopes(
	type: "account" | "site",
	requested: unknown,
	caller: TokenCaller,
): string[] | TokenResult<never> {
	if (requested !== undefined && !Array.isArray(requested)) {
		return fail(400, "scopes must be an array");
	}
	let scopes: unknown[] = (requested as unknown[] | undefined) ?? [];
	if (scopes.length === 0) {
		const defaults = type === "account" ? DEFAULT_ACCOUNT_SCOPES : DEFAULT_SITE_SCOPES;
		// An API token only hands down defaults it holds itself, never the ability to mint more.
		scopes = caller.via
			? defaults.filter((s) => s !== SCOPES.TOKENS_WRITE && caller.via?.scopes.includes(s))
			: defaults;
	}
	const known = Object.values(SCOPES) as string[];
	const unknown = scopes.filter((s) => typeof s !== "string" || !known.includes(s));
	if (unknown.length > 0) return fail(400, `Invalid scopes: ${unknown.join(", ")}`);
	const valid = scopes as string[];

	if (type === "site") {
		const disallowed = valid.filter((s) => !SITE_TOKEN_SCOPES.includes(s));
		if (disallowed.length > 0) {
			return fail(400, `Site tokens can only have scopes: ${SITE_TOKEN_SCOPES.join(", ")}`);
		}
	}

	if (caller.via) {
		if (caller.via.type === "site") return fail(403, "Site tokens cannot create tokens");
		if (valid.includes(SCOPES.TOKENS_WRITE)) {
			return fail(403, "tokens:write can only be granted from the dashboard");
		}
		const beyond = valid.filter((s) => !caller.via?.scopes.includes(s));
		if (beyond.length > 0) {
			return fail(403, `A token cannot grant scopes it does not hold: ${beyond.join(", ")}`);
		}
	}
	return [...new Set(valid)];
}

/** Create an account or site token, enforcing site role, scope ceiling and plan limit. */
export async function createApiToken(
	db: Kysely<KlikapaDatabase>,
	env: { SELF_HOSTED?: string } | undefined,
	caller: TokenCaller,
	input: CreateTokenInput,
): Promise<TokenResult<CreateTokenResponse>> {
	const { name, type, site_id: siteId } = input;
	if (typeof name !== "string" || !name.trim() || !type) {
		return fail(400, "name and type are required");
	}
	if (type !== "account" && type !== "site") return fail(400, "type must be 'account' or 'site'");
	if (type === "site" && (typeof siteId !== "string" || !siteId)) {
		return fail(400, "site_id is required for site tokens");
	}

	const scopes = resolveScopes(type, input.scopes, caller);
	if (!Array.isArray(scopes)) return scopes;

	if (type === "site") {
		// A token that reports events changes data, so it needs a write role; reading needs any role.
		const action = scopes.includes(SCOPES.EVENTS_WRITE) ? "write" : "read";
		const { denied } = await checkSiteAccess(db, caller.userId, siteId as string, action);
		if (denied) return fail(denied.status, denied.error);
	}

	const sub = await db
		.selectFrom("subscriptions")
		.select(["plan"])
		.where("user_id", "=", caller.userId)
		.executeTakeFirst();
	const plan = sub?.plan ?? "free";
	const maxTokens = isSelfHosted(env) ? Infinity : (PLAN_TOKEN_LIMITS[plan] ?? 2);
	const existing = await db
		.selectFrom("api_keys")
		.select(({ fn }) => [fn.count<number>("id").as("count")])
		.where("user_id", "=", caller.userId)
		.where("token_type", "in", ["account", "site"])
		.executeTakeFirst();
	if (Number(existing?.count ?? 0) >= maxTokens) {
		return fail(
			403,
			`Token limit reached. Your plan (${plan}) allows up to ${maxTokens === Infinity ? "unlimited" : maxTokens} API tokens.`,
		);
	}

	const { key, prefix } = generateApiKey(type);
	const id = generateId();
	const now = new Date().toISOString();
	const boundSite = type === "site" ? (siteId as string) : null;
	await db
		.insertInto("api_keys")
		.values({
			id,
			user_id: caller.userId,
			key_hash: await hashToken(key),
			key_prefix: prefix,
			name: name.trim(),
			token_type: type,
			scopes: JSON.stringify(scopes),
			site_id: boundSite,
			last_used_at: null,
			expires_at: null,
			created_at: now,
		})
		.execute();

	return {
		ok: true,
		data: {
			id,
			token: key,
			prefix,
			name: name.trim(),
			type,
			scopes,
			site_id: boundSite,
			created_at: now,
		},
	};
}

export async function listApiTokens(
	db: Kysely<KlikapaDatabase>,
	userId: string,
): Promise<TokenInfo[]> {
	const keys = await db
		.selectFrom("api_keys")
		.select(["id", "key_prefix", "name", "token_type", "scopes", "site_id", "last_used_at", "created_at"])
		.where("user_id", "=", userId)
		.where("token_type", "in", ["account", "site"])
		.orderBy("created_at", "desc")
		.execute();
	return keys.map((k) => {
		let scopes: string[] = [];
		try {
			scopes = k.scopes ? JSON.parse(k.scopes) : [];
		} catch {
			scopes = [];
		}
		return {
			id: k.id,
			prefix: k.key_prefix,
			name: k.name,
			type: k.token_type as "account" | "site",
			scopes,
			site_id: k.site_id,
			last_used_at: k.last_used_at,
			created_at: k.created_at,
		};
	});
}

/** Revoke one of the caller's own account or site tokens. Session tokens end through logout. */
export async function revokeApiToken(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	tokenId: string,
): Promise<TokenResult<{ id: string; revoked: true }>> {
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["id", "user_id", "token_type"])
		.where("id", "=", tokenId)
		.executeTakeFirst();
	if (!apiKey) return fail(404, "Token not found");
	if (apiKey.user_id !== userId) return fail(403, "You can only revoke your own tokens");
	if (apiKey.token_type === "session") {
		return fail(400, "Cannot revoke session tokens via this endpoint");
	}
	await db.deleteFrom("api_keys").where("id", "=", tokenId).execute();
	return { ok: true, data: { id: tokenId, revoked: true } };
}

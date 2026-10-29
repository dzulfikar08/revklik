import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateApiKey, generateId, hashToken } from "../utils";

export const SESSION_TTL_MS = 30 * 86_400_000;
/** Sliding refresh is written at most once a day per token. */
const REFRESH_AFTER_MS = 86_400_000;

export const sessionExpiry = (now = Date.now()) => new Date(now + SESSION_TTL_MS).toISOString();

/** Mint a kp_ session token (30-day sliding expiry) and return the plaintext key. */
export async function issueSessionToken(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	name = "session",
): Promise<string> {
	const { key } = generateApiKey("session");
	const now = new Date().toISOString();
	await db
		.insertInto("api_keys")
		.values({
			id: generateId(),
			user_id: userId,
			key_hash: await hashToken(key),
			key_prefix: key.slice(0, 7),
			name,
			token_type: "session",
			scopes: null,
			site_id: null,
			last_used_at: null,
			expires_at: sessionExpiry(),
			created_at: now,
		})
		.execute();
	return key;
}

/** Push a session's expiry out to now + 30 days once it has aged a day. */
export async function refreshSessionExpiry(
	db: Kysely<KlikapaDatabase>,
	keyHash: string,
	expiresAt: string | null,
	now = Date.now(),
): Promise<void> {
	const current = expiresAt ? new Date(expiresAt).getTime() : 0;
	if (current - now > SESSION_TTL_MS - REFRESH_AFTER_MS) return;
	await db
		.updateTable("api_keys")
		.set({ expires_at: sessionExpiry(now) })
		.where("key_hash", "=", keyHash)
		.where("token_type", "=", "session")
		.execute();
}

export interface ResolvedSession {
	userId: string;
	/** When this session token was minted (ISO). */
	createdAt: string;
}

/**
 * Resolve the kp_ session behind a Bearer token (rvt_/rv_ and expired tokens
 * are rejected). Link and switch routes resolve their own auth, like
 * /auth/me, because they sit on the public /auth mount.
 */
export async function resolveSession(
	db: Kysely<KlikapaDatabase> | undefined,
	authHeader: string | undefined,
): Promise<ResolvedSession | null> {
	if (!db || !authHeader?.startsWith("Bearer ")) return null;
	const keyHash = await hashToken(authHeader.slice(7));
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["user_id", "token_type", "expires_at", "created_at"])
		.where("key_hash", "=", keyHash)
		.executeTakeFirst();
	if (!apiKey || apiKey.token_type !== "session") return null;
	if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date()) return null;
	await refreshSessionExpiry(db, keyHash, apiKey.expires_at);
	return { userId: apiKey.user_id, createdAt: apiKey.created_at };
}

export async function resolveSessionUserId(
	db: Kysely<KlikapaDatabase> | undefined,
	authHeader: string | undefined,
): Promise<string | null> {
	return (await resolveSession(db, authHeader))?.userId ?? null;
}

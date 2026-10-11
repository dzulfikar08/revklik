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

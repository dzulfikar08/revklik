import { ORPCError } from "@orpc/server";
import { env } from "@revklik/env/server";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { protectedProcedure } from "../index";

/**
 * Bridge to the production revklik (klikapa) analytics app, Option B
 * "human-approved": a signed-in better-auth session mints a klikapa session
 * API token (`kp_…`) by looking up the klikapa user with the SAME email.
 * There is no auto-provisioning — the user must already exist in klikapa.
 *
 * The klikapa worker owns the real schema; these minimal table mirrors exist
 * only to read `users` and write/delete `api_keys` rows named "revklik-new".
 * Token storage matches klikapa exactly: `key_hash` is the SHA-256 hex of the
 * full token, `key_prefix` is `token.slice(0, 7)`.
 */

const klikapaUsers = sqliteTable("users", {
	id: text("id").primaryKey(),
	email: text("email").notNull(),
	name: text("name").notNull(),
	role: text("role").notNull().default("user"),
});
const klikapaApiKeys = sqliteTable("api_keys", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull(),
	keyHash: text("key_hash").notNull(),
	keyPrefix: text("key_prefix").notNull(),
	name: text("name").notNull().default("default"),
	tokenType: text("token_type").notNull().default("session"),
	scopes: text("scopes"),
	siteId: text("site_id"),
	lastUsedAt: text("last_used_at"),
	expiresAt: text("expires_at"),
	createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

const TOKEN_NAME = "revklik-new";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* ------------------------- in-memory mint rate limit ----------------------- */
/* Per-user, per-isolate: enough to stop a runaway client from spamming new
   tokens; not a security boundary. */

const MINT_LIMIT = 5;
const MINT_WINDOW_MS = 60 * 60 * 1000;
const mintLog = new Map<string, number[]>();

function assertMintQuota(userId: string): void {
	const now = Date.now();
	const hits = (mintLog.get(userId) ?? []).filter((t) => now - t < MINT_WINDOW_MS);
	if (hits.length >= MINT_LIMIT) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: `Token mint limit reached (${MINT_LIMIT}/hour) — try again later`,
		});
	}
	hits.push(now);
	mintLog.set(userId, hits);
}

/* ------------------------------ token helpers ------------------------------ */

/** Mirrors klikapa utils.ts generateApiKey("session"): `kp_` + 64 hex chars. */
function generateSessionToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `kp_${hex}`;
}

/** Mirrors klikapa utils.ts hashToken: SHA-256 hex of the full token. */
async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const legacyRouter = {
	mintToken: protectedProcedure.handler(async ({ context }) => {
		const email = context.session.user.email;
		const db = drizzle(env.KLIKAPA_DB);

		const [user] = await db
			.select({
				id: klikapaUsers.id,
				name: klikapaUsers.name,
				email: klikapaUsers.email,
				role: klikapaUsers.role,
			})
			.from(klikapaUsers)
			.where(eq(klikapaUsers.email, email))
			.limit(1);

		if (!user) {
			throw new ORPCError("NOT_FOUND", {
				message: "No klikapa account for this email — sign up in the existing app first",
			});
		}

		assertMintQuota(user.id);

		const token = generateSessionToken();
		const id = crypto.randomUUID();
		const createdAt = new Date();
		const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS).toISOString();

		await db.insert(klikapaApiKeys).values({
			id,
			userId: user.id,
			keyHash: await hashToken(token),
			keyPrefix: token.slice(0, 7),
			name: TOKEN_NAME,
			tokenType: "session",
			scopes: null,
			siteId: null,
			lastUsedAt: null,
			expiresAt,
			createdAt: createdAt.toISOString(),
		});

		// Plaintext token is returned exactly once; only the hash is stored.
		return {
			token,
			user: { id: user.id, name: user.name, email: user.email, role: user.role },
		};
	}),

	revokeToken: protectedProcedure.handler(async ({ context }) => {
		const email = context.session.user.email;
		const db = drizzle(env.KLIKAPA_DB);

		const [user] = await db
			.select({ id: klikapaUsers.id })
			.from(klikapaUsers)
			.where(eq(klikapaUsers.email, email))
			.limit(1);

		if (!user) {
			return { revoked: false };
		}

		await db
			.delete(klikapaApiKeys)
			.where(and(eq(klikapaApiKeys.userId, user.id), eq(klikapaApiKeys.name, TOKEN_NAME)));

		return { revoked: true };
	}),
};

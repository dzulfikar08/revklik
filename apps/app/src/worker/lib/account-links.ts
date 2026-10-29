import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId, hashToken } from "../utils";
import type { AttemptPolicy } from "./attempt-limit";

export const MAX_ACCOUNT_LINKS = 5;
export const LINK_INTENT_TTL_MS = 10 * 60_000;
/** Per signed-in user: password guesses against other accounts. */
export const LINK_ATTEMPT_POLICY: AttemptPolicy = { max: 10, windowMs: 15 * 60_000 };
/** Per target email across every caller, against distributed guessing. */
export const LINK_TARGET_POLICY: AttemptPolicy = { max: 30, windowMs: 60 * 60_000 };

export type LinkFailure = "self" | "already_linked" | "limit_reached" | "not_found";

export interface LinkedUser {
	id: string;
	name: string;
	email: string;
	avatar_url: string | null;
}

export interface LinkEntry {
	id: string;
	user: LinkedUser;
	created_at: string;
}

type Db = Kysely<KlikapaDatabase>;

/** user_a < user_b is the canonical order, so each pair has exactly one row. */
export function orderPair(x: string, y: string): [string, string] {
	return x < y ? [x, y] : [y, x];
}

export async function countLinks(db: Db, userId: string): Promise<number> {
	const row = await db
		.selectFrom("account_links")
		.select((eb) => eb.fn.countAll<number>().as("n"))
		.where((eb) => eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]))
		.executeTakeFirst();
	return Number(row?.n ?? 0);
}

export async function areLinked(db: Db, x: string, y: string): Promise<boolean> {
	const [a, b] = orderPair(x, y);
	const row = await db
		.selectFrom("account_links")
		.select("id")
		.where("user_a", "=", a)
		.where("user_b", "=", b)
		.executeTakeFirst();
	return !!row;
}

export async function listLinks(db: Db, userId: string): Promise<LinkEntry[]> {
	const rows = await db
		.selectFrom("account_links")
		.select(["id", "user_a", "user_b", "created_at"])
		.where((eb) => eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]))
		.orderBy("created_at", "asc")
		.execute();
	if (rows.length === 0) return [];
	const otherIds = rows.map((r) => (r.user_a === userId ? r.user_b : r.user_a));
	const users = await db
		.selectFrom("users")
		.select(["id", "name", "email", "avatar_url"])
		.where("id", "in", otherIds)
		.execute();
	const byId = new Map(users.map((u) => [u.id, u]));
	const entries: LinkEntry[] = [];
	for (const r of rows) {
		const user = byId.get(r.user_a === userId ? r.user_b : r.user_a);
		if (user) entries.push({ id: r.id, user, created_at: r.created_at });
	}
	return entries;
}

/** Link two accounts. Either side being at the cap refuses the link. */
export async function createLink(
	db: Db,
	currentUserId: string,
	targetUserId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: LinkFailure }> {
	if (currentUserId === targetUserId) return { ok: false, reason: "self" };
	if (await areLinked(db, currentUserId, targetUserId)) {
		return { ok: false, reason: "already_linked" };
	}
	if (
		(await countLinks(db, currentUserId)) >= MAX_ACCOUNT_LINKS ||
		(await countLinks(db, targetUserId)) >= MAX_ACCOUNT_LINKS
	) {
		return { ok: false, reason: "limit_reached" };
	}
	const [a, b] = orderPair(currentUserId, targetUserId);
	const id = generateId();
	try {
		await db
			.insertInto("account_links")
			.values({
				id,
				user_a: a,
				user_b: b,
				created_at: new Date().toISOString(),
				created_by: currentUserId,
			})
			.execute();
	} catch {
		// A concurrent request created the same pair first (UNIQUE user_a, user_b).
		return { ok: false, reason: "already_linked" };
	}
	return { ok: true, id };
}

/** Mint the one-time nonce a signed-in user needs to start the Google link flow. */
export async function createLinkIntent(db: Db, userId: string): Promise<string> {
	const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
	const now = Date.now();
	await db
		.deleteFrom("account_link_intents")
		.where("expires_at", "<", new Date(now).toISOString())
		.execute();
	await db
		.insertInto("account_link_intents")
		.values({
			token_hash: await hashToken(nonce),
			user_id: userId,
			expires_at: new Date(now + LINK_INTENT_TTL_MS).toISOString(),
		})
		.execute();
	return nonce;
}

/** True while the nonce exists and has not expired; does not consume it. */
export async function isLinkIntentValid(db: Db, nonce: string): Promise<boolean> {
	const row = await db
		.selectFrom("account_link_intents")
		.select("expires_at")
		.where("token_hash", "=", await hashToken(nonce))
		.executeTakeFirst();
	return !!row && new Date(row.expires_at).getTime() > Date.now();
}

/** Single use: returns the owning user id and deletes the intent, or null. */
export async function consumeLinkIntent(db: Db, nonce: string): Promise<string | null> {
	const hash = await hashToken(nonce);
	const row = await db
		.selectFrom("account_link_intents")
		.select(["user_id", "expires_at"])
		.where("token_hash", "=", hash)
		.executeTakeFirst();
	if (!row) return null;
	await db.deleteFrom("account_link_intents").where("token_hash", "=", hash).execute();
	return new Date(row.expires_at).getTime() > Date.now() ? row.user_id : null;
}

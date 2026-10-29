import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId, hashToken } from "../utils";
import type { AttemptPolicy } from "./attempt-limit";

export const MAX_ACCOUNT_LINKS = 5;
export const LINK_INTENT_TTL_MS = 10 * 60_000;
/** Per signed-in user: password guesses against other accounts. */
export const LINK_ATTEMPT_POLICY: AttemptPolicy = { max: 10, windowMs: 15 * 60_000 };
/** A Google-only account must have signed in this recently to start a link. */
export const STEP_UP_SESSION_MS = 10 * 60_000;

export type LinkFailure = "self" | "already_linked" | "limit_reached" | "not_found" | "unverified";

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
	const sides = await db
		.selectFrom("users")
		.select(["id", "email_verified_at"])
		.where("id", "in", [currentUserId, targetUserId])
		.execute();
	const target = sides.find((u) => u.id === targetUserId);
	const current = sides.find((u) => u.id === currentUserId);
	if (!target || !current) return { ok: false, reason: "not_found" };
	// An unverified address may belong to someone else (pre-registered account).
	if (!target.email_verified_at || !current.email_verified_at) {
		return { ok: false, reason: "unverified" };
	}
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

const FLOW_TTL_MS = 10 * 60_000;
const randomSecret = (): string =>
	`${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

/** Begin a Google link flow: the intent is already consumed, the browser is bound by its secret. */
export async function startLinkFlow(
	db: Db,
	ownerId: string,
	state: string,
	browserSecret: string,
): Promise<void> {
	await db
		.deleteFrom("account_link_flows")
		.where("expires_at", "<", new Date().toISOString())
		.execute();
	await db
		.insertInto("account_link_flows")
		.values({
			state_hash: await hashToken(state),
			owner_id: ownerId,
			browser_hash: await hashToken(browserSecret),
			target_id: null,
			code_hash: null,
			expires_at: new Date(Date.now() + FLOW_TTL_MS).toISOString(),
		})
		.execute();
}

/** The flow's owner when the callback comes from the browser that started it; else null. */
export async function getLinkFlowOwner(
	db: Db,
	state: string,
	browserSecret: string | undefined,
): Promise<string | null> {
	if (!browserSecret) return null;
	const row = await db
		.selectFrom("account_link_flows")
		.select(["owner_id", "browser_hash", "target_id", "expires_at"])
		.where("state_hash", "=", await hashToken(state))
		.executeTakeFirst();
	if (!row || row.target_id) return null;
	if (new Date(row.expires_at).getTime() <= Date.now()) return null;
	if (row.browser_hash !== (await hashToken(browserSecret))) return null;
	return row.owner_id;
}

/** Record the Google-proven account and return the one-time code for the owner's session. */
export async function setLinkFlowTarget(db: Db, state: string, targetId: string): Promise<string> {
	const code = randomSecret();
	await db
		.updateTable("account_link_flows")
		.set({ target_id: targetId, code_hash: await hashToken(code) })
		.where("state_hash", "=", await hashToken(state))
		.execute();
	return code;
}

export interface PendingLink {
	stateHash: string;
	ownerId: string;
	targetId: string;
}

export async function findPendingLink(db: Db, code: string): Promise<PendingLink | null> {
	const row = await db
		.selectFrom("account_link_flows")
		.select(["state_hash", "owner_id", "target_id", "expires_at"])
		.where("code_hash", "=", await hashToken(code))
		.executeTakeFirst();
	if (!row?.target_id || new Date(row.expires_at).getTime() <= Date.now()) return null;
	return { stateHash: row.state_hash, ownerId: row.owner_id, targetId: row.target_id };
}

export async function deletePendingLink(db: Db, stateHash: string): Promise<void> {
	await db.deleteFrom("account_link_flows").where("state_hash", "=", stateHash).execute();
}

/** Session name that tags tokens minted by /auth/switch, so unlinking can revoke them. */
export const switchSessionName = (sourceUserId: string): string => `switch:${sourceUserId}`;

/**
 * Unlinking revokes EVERY switch-minted session of both participants. A chain
 * (A to B to C to B) re-tags sessions with the middle account, so matching on
 * the source id would miss them; the sessions are cheap to remint.
 */
export async function revokeSwitchSessions(db: Db, x: string, y: string): Promise<void> {
	await db
		.deleteFrom("api_keys")
		.where("user_id", "in", [x, y])
		.where("token_type", "=", "session")
		.where("name", "like", "switch:%")
		.execute();
}

/**
 * Account recovery (password reset, Google takeover of an unverified account):
 * drop every link, pending Google flow and switch session that involves the
 * user or its former link partners, so a recovered account cannot be reached
 * through an old link or a chained switch session.
 */
export async function removeAccountLinks(db: Db, userId: string): Promise<void> {
	const links = await db
		.selectFrom("account_links")
		.select(["user_a", "user_b"])
		.where((eb) => eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]))
		.execute();
	const affected = new Set<string>([userId]);
	for (const l of links) {
		affected.add(l.user_a);
		affected.add(l.user_b);
	}
	await db
		.deleteFrom("account_links")
		.where((eb) => eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]))
		.execute();
	await db.deleteFrom("account_link_intents").where("user_id", "=", userId).execute();
	await db
		.deleteFrom("account_link_flows")
		.where((eb) => eb.or([eb("owner_id", "=", userId), eb("target_id", "=", userId)]))
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("user_id", "in", [...affected])
		.where("token_type", "=", "session")
		.where("name", "like", "switch:%")
		.execute();
}

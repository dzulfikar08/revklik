import { Hono } from "hono";
import type { ExpressionBuilder, Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import {
	areLinked,
	createLink,
	createLinkIntent,
	LINK_ATTEMPT_POLICY,
	LINK_TARGET_POLICY,
	listLinks,
	type LinkFailure,
} from "../lib/account-links";
import { clearAttempts, isLimited, recordAttempt } from "../lib/attempt-limit";
import { issueSessionToken, resolveSessionUserId } from "../lib/session";
import type { Env } from "../types";
import { hashPassword, normalizeEmail, verifyPassword } from "../utils";

/** Linked accounts and the switcher. Session (kp_) tokens only. */
export const accountLinkRoutes = new Hono<Env>();

const FAILURE_STATUS: Record<LinkFailure, 400 | 404 | 409> = {
	self: 400,
	already_linked: 409,
	limit_reached: 409,
	not_found: 404,
};

const unauthorized = { error: "Session token required", success: false } as const;

function findUserByEmail(db: Kysely<KlikapaDatabase>, email: string) {
	return db
		.selectFrom("users")
		.select(["id", "name", "email", "avatar_url", "password_hash", "role"])
		.where(sql<string>`lower(email)`, "=", email)
		.executeTakeFirst();
}

accountLinkRoutes.get("/links", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveSessionUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json(unauthorized, 401);
	return c.json({ data: await listLinks(db, userId), success: true });
});

// POST /auth/links {email, password} — prove ownership of another account once
accountLinkRoutes.post("/links", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveSessionUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json(unauthorized, 401);

	const body = await c.req.json().catch(() => ({}));
	const email = normalizeEmail(body?.email);
	const password = typeof body?.password === "string" ? body.password : "";
	const userKey = `link:${userId}:${email}`;
	const callerKey = `link-user:${userId}`;
	const targetKey = `link-target:${email}`;
	if (
		(await isLimited(db, userKey, LINK_ATTEMPT_POLICY)) ||
		(await isLimited(db, callerKey, LINK_ATTEMPT_POLICY)) ||
		(await isLimited(db, targetKey, LINK_TARGET_POLICY))
	) {
		return c.json({ error: "too_many_attempts", success: false }, 429);
	}

	const target = email ? await findUserByEmail(db, email) : undefined;
	// An empty hash is a Google-only account: it has no password to prove.
	const check = target?.password_hash
		? await verifyPassword(password, target.password_hash)
		: { ok: false, needsRehash: false };
	if (!target || !check.ok) {
		await recordAttempt(db, userKey, LINK_ATTEMPT_POLICY);
		await recordAttempt(db, callerKey, LINK_ATTEMPT_POLICY);
		await recordAttempt(db, targetKey, LINK_TARGET_POLICY);
		return c.json({ error: "Invalid credentials", success: false }, 401);
	}
	await clearAttempts(db, userKey);
	await clearAttempts(db, targetKey);
	if (check.needsRehash) {
		await db
			.updateTable("users")
			.set({ password_hash: await hashPassword(password) })
			.where("id", "=", target.id)
			.execute();
	}

	const result = await createLink(db, userId, target.id);
	if (!result.ok)
		return c.json({ error: result.reason, success: false }, FAILURE_STATUS[result.reason]);
	return c.json(
		{
			data: {
				id: result.id,
				user: {
					id: target.id,
					name: target.name,
					email: target.email,
					avatar_url: target.avatar_url,
				},
			},
			success: true,
		},
		201,
	);
});

// POST /auth/links/google-intent — one-time nonce to start GET /auth/google?link=<nonce>
accountLinkRoutes.post("/links/google-intent", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveSessionUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json(unauthorized, 401);
	const key = `link-intent:${userId}`;
	if (await isLimited(db, key, LINK_ATTEMPT_POLICY)) {
		return c.json({ error: "too_many_attempts", success: false }, 429);
	}
	await recordAttempt(db, key, LINK_ATTEMPT_POLICY);
	return c.json({ data: { intent: await createLinkIntent(db, userId) }, success: true });
});

// DELETE /auth/links/:id — either participant may unlink
accountLinkRoutes.delete("/links/:id", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveSessionUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json(unauthorized, 401);
	const id = c.req.param("id");
	const isParticipant = (eb: ExpressionBuilder<KlikapaDatabase, "account_links">) =>
		eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]);
	const existing = await db
		.selectFrom("account_links")
		.select("id")
		.where("id", "=", id)
		.where(isParticipant)
		.executeTakeFirst();
	if (!existing) return c.json({ error: "Link not found", success: false }, 404);
	await db.deleteFrom("account_links").where("id", "=", id).where(isParticipant).execute();
	return c.json({ data: { unlinked: true }, success: true });
});

// POST /auth/switch {user_id} — new session for a directly linked account
accountLinkRoutes.post("/switch", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveSessionUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json(unauthorized, 401);
	const body = await c.req.json().catch(() => ({}));
	const targetId = typeof body?.user_id === "string" ? body.user_id : "";
	if (!targetId || targetId === userId || !(await areLinked(db, userId, targetId))) {
		return c.json({ error: "Account not linked", success: false }, 403);
	}
	const user = await db
		.selectFrom("users")
		.select(["id", "name", "email", "role"])
		.where("id", "=", targetId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "Account not linked", success: false }, 403);
	const token = await issueSessionToken(db, user.id);
	return c.json({
		data: {
			user: { id: user.id, name: user.name, email: user.email, role: user.role },
			token,
		},
		success: true,
	});
});

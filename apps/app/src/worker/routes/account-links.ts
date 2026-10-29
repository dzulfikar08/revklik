import { Hono } from "hono";
import type { Context } from "hono";
import type { ExpressionBuilder, Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import {
	areLinked,
	createLink,
	createLinkIntent,
	deletePendingLink,
	findPendingLink,
	LINK_ATTEMPT_POLICY,
	listLinks,
	revokeSwitchSessions,
	STEP_UP_SESSION_MS,
	switchSessionName,
	type LinkFailure,
} from "../lib/account-links";
import { clearAttempts, isLimited, LOGIN_EMAIL_POLICY, recordAttempt } from "../lib/attempt-limit";
import { sendAccountLinkedNotice } from "../lib/email";
import { issueSessionToken, resolveSession, type ResolvedSession } from "../lib/session";
import type { Env } from "../types";
import { hashPassword, normalizeEmail, verifyPassword } from "../utils";

/** Linked accounts and the switcher. Session (kp_) tokens only. */
export const accountLinkRoutes = new Hono<Env>();

const FAILURE_STATUS: Record<LinkFailure, 400 | 403 | 404 | 409> = {
	self: 400,
	already_linked: 409,
	limit_reached: 409,
	not_found: 404,
	unverified: 403,
};

const unauthorized = { error: "Session token required", success: false } as const;

function findUserByEmail(db: Kysely<KlikapaDatabase>, email: string) {
	return db
		.selectFrom("users")
		.select(["id", "name", "email", "avatar_url", "password_hash", "role", "email_verified_at"])
		.where(sql<string>`lower(email)`, "=", email)
		.executeTakeFirst();
}

type StepUp = { ok: true } | { ok: false; status: 403 | 429; error: string };

/**
 * Linking is a takeover primitive, so a stolen session alone must not be
 * enough: the caller proves the CURRENT account's password. Google-only
 * accounts have none and instead need a session minted in the last 10 minutes.
 * Wrong guesses count against the login budget of the current account's email.
 */
async function requireStepUp(
	db: Kysely<KlikapaDatabase>,
	session: ResolvedSession,
	currentPassword: string,
): Promise<StepUp> {
	const me = await db
		.selectFrom("users")
		.select(["email", "password_hash"])
		.where("id", "=", session.userId)
		.executeTakeFirst();
	if (!me) return { ok: false, status: 403, error: "current_password_invalid" };
	if (!me.password_hash) {
		const age = Date.now() - new Date(session.createdAt).getTime();
		return age <= STEP_UP_SESSION_MS
			? { ok: true }
			: { ok: false, status: 403, error: "recent_login_required" };
	}
	const key = `login-email:${normalizeEmail(me.email)}`;
	if (await isLimited(db, key, LOGIN_EMAIL_POLICY)) {
		return { ok: false, status: 429, error: "too_many_attempts" };
	}
	const check = await verifyPassword(currentPassword, me.password_hash);
	if (!check.ok) {
		await recordAttempt(db, key, LOGIN_EMAIL_POLICY);
		return { ok: false, status: 403, error: "current_password_invalid" };
	}
	return { ok: true };
}

async function notifyLinked(
	c: Context<Env>,
	db: Kysely<KlikapaDatabase>,
	x: string,
	y: string,
): Promise<void> {
	const users = await db
		.selectFrom("users")
		.select(["id", "email"])
		.where("id", "in", [x, y])
		.execute();
	const a = users.find((u) => u.id === x);
	const b = users.find((u) => u.id === y);
	if (!a || !b) return;
	c.executionCtx.waitUntil(
		sendAccountLinkedNotice(
			[
				{ to: a.email, other: b.email },
				{ to: b.email, other: a.email },
			],
			c.env.EMAIL,
			c.env.EMAIL_FROM,
		),
	);
}

accountLinkRoutes.get("/links", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	return c.json({ data: await listLinks(db, session.userId), success: true });
});

// POST /auth/links {email, password, current_password} — prove ownership of another account once
accountLinkRoutes.post("/links", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	const userId = session.userId;

	const body = await c.req.json().catch(() => ({}));
	const email = normalizeEmail(body?.email);
	const password = typeof body?.password === "string" ? body.password : "";
	const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
	// Guesses at the target's password spend the same budget as /auth/login.
	const emailKey = `login-email:${email}`;
	const callerKey = `link-user:${userId}`;
	if (
		(await isLimited(db, emailKey, LOGIN_EMAIL_POLICY)) ||
		(await isLimited(db, callerKey, LINK_ATTEMPT_POLICY))
	) {
		return c.json({ error: "too_many_attempts", success: false }, 429);
	}
	const stepUp = await requireStepUp(db, session, currentPassword);
	if (!stepUp.ok) return c.json({ error: stepUp.error, success: false }, stepUp.status);

	const target = email ? await findUserByEmail(db, email) : undefined;
	// An empty hash is a Google-only account: it has no password to prove.
	const check = target?.password_hash
		? await verifyPassword(password, target.password_hash)
		: { ok: false, needsRehash: false };
	if (!target || !check.ok) {
		await recordAttempt(db, emailKey, LOGIN_EMAIL_POLICY);
		await recordAttempt(db, callerKey, LINK_ATTEMPT_POLICY);
		return c.json({ error: "Invalid credentials", success: false }, 401);
	}
	await clearAttempts(db, emailKey);
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
	await notifyLinked(c, db, userId, target.id);
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

// POST /auth/links/google-intent {current_password} — one-time nonce for GET /auth/google?link=<nonce>
accountLinkRoutes.post("/links/google-intent", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	const key = `link-intent:${session.userId}`;
	if (await isLimited(db, key, LINK_ATTEMPT_POLICY)) {
		return c.json({ error: "too_many_attempts", success: false }, 429);
	}
	const body = await c.req.json().catch(() => ({}));
	const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
	const stepUp = await requireStepUp(db, session, currentPassword);
	if (!stepUp.ok) return c.json({ error: stepUp.error, success: false }, stepUp.status);
	await recordAttempt(db, key, LINK_ATTEMPT_POLICY);
	return c.json({ data: { intent: await createLinkIntent(db, session.userId) }, success: true });
});

/** The pending Google link behind `code`, only for the session that started it. */
async function ownedPendingLink(
	db: Kysely<KlikapaDatabase>,
	session: ResolvedSession,
	code: unknown,
) {
	if (typeof code !== "string" || !code) return null;
	const pending = await findPendingLink(db, code);
	return pending && pending.ownerId === session.userId ? pending : null;
}

// POST /auth/links/google/preview {code} — which account is about to be linked
accountLinkRoutes.post("/links/google/preview", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	const body = await c.req.json().catch(() => ({}));
	const pending = await ownedPendingLink(db, session, body?.code);
	if (!pending) return c.json({ error: "Invalid or expired code", success: false }, 403);
	const user = await db
		.selectFrom("users")
		.select(["id", "name", "email", "avatar_url"])
		.where("id", "=", pending.targetId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "Invalid or expired code", success: false }, 403);
	return c.json({ data: { user }, success: true });
});

// POST /auth/links/google/complete {code} — the intent owner's own session creates the link
accountLinkRoutes.post("/links/google/complete", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	const body = await c.req.json().catch(() => ({}));
	const pending = await ownedPendingLink(db, session, body?.code);
	if (!pending) return c.json({ error: "Invalid or expired code", success: false }, 403);
	await deletePendingLink(db, pending.stateHash);
	const result = await createLink(db, session.userId, pending.targetId);
	if (!result.ok)
		return c.json({ error: result.reason, success: false }, FAILURE_STATUS[result.reason]);
	const user = await db
		.selectFrom("users")
		.select(["id", "name", "email", "avatar_url"])
		.where("id", "=", pending.targetId)
		.executeTakeFirst();
	await notifyLinked(c, db, session.userId, pending.targetId);
	return c.json({ data: { id: result.id, user }, success: true }, 201);
});

// DELETE /auth/links/:id — either participant may unlink; sessions minted across the link die
accountLinkRoutes.delete("/links/:id", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	const userId = session.userId;
	const id = c.req.param("id");
	const isParticipant = (eb: ExpressionBuilder<KlikapaDatabase, "account_links">) =>
		eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]);
	const existing = await db
		.selectFrom("account_links")
		.select(["user_a", "user_b"])
		.where("id", "=", id)
		.where(isParticipant)
		.executeTakeFirst();
	if (!existing) return c.json({ error: "Link not found", success: false }, 404);
	await db.deleteFrom("account_links").where("id", "=", id).where(isParticipant).execute();
	await revokeSwitchSessions(db, existing.user_a, existing.user_b);
	return c.json({ data: { unlinked: true }, success: true });
});

// POST /auth/switch {user_id} — new session for a directly linked account
accountLinkRoutes.post("/switch", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json(unauthorized, 401);
	const userId = session.userId;
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
	const token = await issueSessionToken(db, user.id, switchSessionName(userId));
	return c.json({
		data: {
			user: { id: user.id, name: user.name, email: user.email, role: user.role },
			token,
		},
		success: true,
	});
});

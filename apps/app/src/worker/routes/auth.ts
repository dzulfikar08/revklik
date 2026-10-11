import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { recordReferralSignup } from "../lib/affiliates";
import {
	clearAttempts,
	isLimited,
	LOGIN_POLICY,
	recordAttempt,
	RESET_REQUEST_POLICY,
} from "../lib/attempt-limit";
import { sendEmail, sendNewSignupAlert } from "../lib/email";
import { PLANS } from "../lib/plans";
import { issueSessionToken, refreshSessionExpiry } from "../lib/session";
import { startTrial } from "../lib/trial";
import type { Env } from "../types";
import { generateId, hashPassword, hashToken, normalizeEmail, verifyPassword } from "../utils";

export const authRoutes = new Hono<Env>();

const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MS = 3_600_000;
const OAUTH_COOKIE = "rk_oauth";
const OAUTH_COOKIE_MAX_AGE = 600;
// Native app callbacks allowed as OAuth redirect_to targets (besides same-origin URLs).
const NATIVE_REDIRECT_SCHEMES = ["revklik-new:", "revklik:"];

/**
 * Resolve the dashboard user from the presented Bearer token. /auth/me and
 * /auth/logout act on the caller's own token, so they resolve it inline —
 * session (kp_) and account (rvt_) tokens accepted, site-scoped rv_ and
 * expired tokens rejected — instead of relying on app-level middleware
 * mounts, which silently fail to fire for these exact-path routes.
 */
async function resolveTokenUserId(
	db: Kysely<KlikapaDatabase> | undefined,
	authHeader: string | undefined,
): Promise<string | null> {
	if (!db || !authHeader?.startsWith("Bearer ")) return null;
	const keyHash = await hashToken(authHeader.slice(7));
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["user_id", "token_type", "expires_at"])
		.where("key_hash", "=", keyHash)
		.executeTakeFirst();
	if (!apiKey) return null;
	if (apiKey.token_type !== "session" && apiKey.token_type !== "account") return null;
	if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date()) return null;
	if (apiKey.token_type === "session") await refreshSessionExpiry(db, keyHash, apiKey.expires_at);
	return apiKey.user_id;
}

function findUserByEmail(db: Kysely<KlikapaDatabase>, email: string) {
	return db
		.selectFrom("users")
		.select(["id", "name", "email", "password_hash", "role"])
		.where(sql<string>`lower(email)`, "=", email)
		.executeTakeFirst();
}

function clientIp(header: string | undefined): string {
	return header || "unknown";
}

// POST /auth/register — optional `ref` (affiliate code) and `plan` (intent only)
authRoutes.post("/register", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const body = await c.req.json().catch(() => ({}));
	const { name, password, plan, ref } = body as Record<string, unknown>;
	const email = normalizeEmail(body?.email);
	const intendedPlan = typeof plan === "string" && plan in PLANS ? plan : null;
	if (typeof name !== "string" || !name.trim() || !email || typeof password !== "string")
		return c.json({ error: "All fields required", success: false }, 400);
	if (password.length < MIN_PASSWORD_LENGTH)
		return c.json(
			{ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, success: false },
			400,
		);

	if (await findUserByEmail(db, email))
		return c.json({ error: "Email taken", success: false }, 409);

	const superAdminEmail = normalizeEmail(c.env.SUPER_ADMIN_EMAIL);
	const role = superAdminEmail && email === superAdminEmail ? "super_admin" : "user";
	const userId = generateId();
	await db
		.insertInto("users")
		.values({
			id: userId,
			email,
			password_hash: await hashPassword(password),
			name,
			role,
			intended_plan: intendedPlan,
			created_at: new Date().toISOString(),
		})
		.execute();
	const key = await issueSessionToken(db, userId, "default");
	if (superAdminEmail && role !== "super_admin") {
		c.executionCtx.waitUntil(
			sendNewSignupAlert(superAdminEmail, { name, email, via: "password" }, c.env.EMAIL),
		);
	}

	try {
		await recordReferralSignup(db, ref ?? c.req.query("ref"), userId);
	} catch (err) {
		console.error("[auth] referral tracking failed:", err);
	}

	await startTrial(db, userId);

	return c.json(
		{
			data: {
				user: { id: userId, name, email, role },
				token: key,
				intended_plan: intendedPlan,
			},
			success: true,
		},
		201,
	);
});

// POST /auth/login — throttled per IP + email; legacy hashes upgrade on success
authRoutes.post("/login", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const body = await c.req.json().catch(() => ({}));
	const email = normalizeEmail(body?.email);
	const password = typeof body?.password === "string" ? body.password : "";
	const limitKey = `login:${clientIp(c.req.header("cf-connecting-ip"))}:${email}`;
	if (await isLimited(db, limitKey, LOGIN_POLICY)) {
		return c.json({ error: "too_many_attempts", success: false }, 429);
	}

	const user = email ? await findUserByEmail(db, email) : undefined;
	const check = user
		? await verifyPassword(password, user.password_hash)
		: { ok: false, needsRehash: false };
	if (!user || !check.ok) {
		await recordAttempt(db, limitKey, LOGIN_POLICY);
		return c.json({ error: "Invalid credentials", success: false }, 401);
	}
	await clearAttempts(db, limitKey);
	if (check.needsRehash) {
		await db
			.updateTable("users")
			.set({ password_hash: await hashPassword(password) })
			.where("id", "=", user.id)
			.execute();
	}

	const key = await issueSessionToken(db, user.id);
	return c.json({
		data: {
			user: { id: user.id, name: user.name, email: user.email, role: user.role },
			token: key,
		},
		success: true,
	});
});

// POST /auth/forgot-password — always 200 so the response never reveals accounts
authRoutes.post("/forgot-password", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const body = await c.req.json().catch(() => ({}));
	const email = normalizeEmail(body?.email);
	const limitKey = `reset:${clientIp(c.req.header("cf-connecting-ip"))}:${email}`;
	if (!email || (await isLimited(db, limitKey, RESET_REQUEST_POLICY))) {
		return c.json({ success: true });
	}
	await recordAttempt(db, limitKey, RESET_REQUEST_POLICY);

	const user = await findUserByEmail(db, email);
	if (user) {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		await db
			.insertInto("password_resets")
			.values({
				id: generateId(),
				user_id: user.id,
				token_hash: await hashToken(token),
				expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
				used_at: null,
				created_at: new Date().toISOString(),
			})
			.execute();
		const link = `${c.env.APP_URL || "https://app.revklik.com"}/reset-password?token=${token}`;
		c.executionCtx.waitUntil(
			sendEmail(
				{
					to: user.email,
					subject: "RevKlik — reset your password",
					html: `<p>Someone asked to reset the password for this RevKlik account.</p><p><a href="${link}">Choose a new password</a> (link valid for 1 hour, single use).</p><p>If it wasn't you, ignore this email.</p>`,
					text: `Reset your RevKlik password (valid 1 hour): ${link}`,
				},
				c.env.EMAIL,
			),
		);
	}
	return c.json({ success: true });
});

// POST /auth/reset-password — single-use token; signs out every session
authRoutes.post("/reset-password", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const body = await c.req.json().catch(() => ({}));
	const token = typeof body?.token === "string" ? body.token : "";
	const password = typeof body?.password === "string" ? body.password : "";
	if (password.length < MIN_PASSWORD_LENGTH) {
		return c.json(
			{ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, success: false },
			400,
		);
	}
	const nowIso = new Date().toISOString();
	const claimed = token
		? await db
				.updateTable("password_resets")
				.set({ used_at: nowIso })
				.where("token_hash", "=", await hashToken(token))
				.where("used_at", "is", null)
				.where("expires_at", ">", nowIso)
				.returning("user_id")
				.execute()
		: [];
	const userId = claimed[0]?.user_id;
	if (!userId) return c.json({ error: "Invalid or expired token", success: false }, 400);

	await db
		.updateTable("users")
		.set({ password_hash: await hashPassword(password) })
		.where("id", "=", userId)
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("user_id", "=", userId)
		.where("token_type", "=", "session")
		.execute();
	return c.json({ success: true });
});

// POST /auth/logout — delete the presented session token (resolves its own auth)
authRoutes.post("/logout", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveTokenUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json({ error: "Unauthorized", success: false }, 401);
	await db
		.deleteFrom("api_keys")
		.where("key_hash", "=", await hashToken(c.req.header("Authorization")!.slice(7)))
		.where("user_id", "=", userId)
		.execute();
	return c.json({ data: { loggedOut: true }, success: true });
});

interface OAuthCookie {
	state: string;
	ref?: string;
	plan?: string;
	redirect?: string;
}

/** Only same-origin URLs or the native app's callback schemes may receive a token. */
function safeRedirect(raw: string | undefined, origin: string): string | undefined {
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		if (url.origin === origin || NATIVE_REDIRECT_SCHEMES.includes(url.protocol)) {
			return url.toString().split("#")[0];
		}
	} catch {
		/* not a URL */
	}
	return undefined;
}

// GET /auth/google — initiate Google OAuth; ?ref= and ?redirect_to= ride in the state cookie
authRoutes.get("/google", (c) => {
	const origin = new URL(c.req.url).origin;
	const state = crypto.randomUUID();
	const payload: OAuthCookie = {
		state,
		ref: c.req.query("ref") || undefined,
		plan: c.req.query("plan") || undefined,
		redirect: safeRedirect(c.req.query("redirect_to"), origin),
	};
	setCookie(c, OAUTH_COOKIE, btoa(JSON.stringify(payload)), {
		path: "/api/auth/google",
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		maxAge: OAUTH_COOKIE_MAX_AGE,
	});
	const params = new URLSearchParams({
		client_id: c.env.GOOGLE_CLIENT_ID || "",
		redirect_uri: `${origin}/api/auth/google/callback`,
		response_type: "code",
		scope: "openid email profile",
		state,
		access_type: "offline",
		prompt: "consent",
	});
	return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

function readOAuthCookie(raw: string | undefined): OAuthCookie | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(atob(raw)) as OAuthCookie;
		return typeof parsed.state === "string" ? parsed : null;
	} catch {
		return null;
	}
}

// GET /auth/google/callback — Google OAuth callback
authRoutes.get("/google/callback", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const code = c.req.query("code");
	const state = c.req.query("state");
	if (!code || !state) return c.json({ error: "Missing code or state", success: false }, 400);
	const oauth = readOAuthCookie(getCookie(c, OAUTH_COOKIE));
	deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth/google" });
	if (!oauth || oauth.state !== state) {
		return c.json({ error: "Invalid OAuth state", success: false }, 400);
	}

	const origin = new URL(c.req.url).origin;
	const redirectUri = `${origin}/api/auth/google/callback`;

	let tokenRes: { access_token?: string; error?: string; error_description?: string };
	try {
		const tr = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: c.env.GOOGLE_CLIENT_ID || "",
				client_secret: c.env.GOOGLE_CLIENT_SECRET || "",
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
			}),
		});
		tokenRes = await tr.json();
	} catch {
		return c.json({ error: "OAuth token exchange failed", success: false }, 500);
	}
	if (tokenRes.error)
		return c.json({ error: tokenRes.error_description || tokenRes.error, success: false }, 400);

	let profile: {
		email?: string | null;
		sub?: string | null;
		name?: string | null;
		picture?: string | null;
	};
	try {
		const pr = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
			headers: { Authorization: `Bearer ${tokenRes.access_token}` },
		});
		profile = await pr.json();
	} catch {
		return c.json({ error: "Failed to get profile", success: false }, 500);
	}
	const googleEmail = normalizeEmail(profile.email);
	if (!googleEmail) return c.json({ error: "No email from Google", success: false }, 400);

	const googleSub = profile.sub ?? null;
	const superAdminEmail = normalizeEmail(c.env.SUPER_ADMIN_EMAIL);
	const isSuperAdmin = !!superAdminEmail && googleEmail === superAdminEmail;

	const existingUser = await db
		.selectFrom("users")
		.select(["id", "email", "name", "role", "google_id", "avatar_url"])
		.where((eb) =>
			eb.or([
				googleSub ? eb("google_id", "=", googleSub) : eb("id", "=", "__never__"),
				eb(sql<string>`lower(email)`, "=", googleEmail),
			]),
		)
		.executeTakeFirst();

	let userId: string;
	if (existingUser) {
		userId = existingUser.id;
		if (!existingUser.google_id && googleSub) {
			await db
				.updateTable("users")
				.set({ google_id: googleSub, avatar_url: profile.picture || existingUser.avatar_url })
				.where("id", "=", userId)
				.execute();
		}
		if (isSuperAdmin && existingUser.role !== "super_admin") {
			await db.updateTable("users").set({ role: "super_admin" }).where("id", "=", userId).execute();
		}
	} else {
		userId = generateId();
		const name = profile.name || googleEmail.split("@")[0] || googleEmail;
		await db
			.insertInto("users")
			.values({
				id: userId,
				email: googleEmail,
				name,
				password_hash: "",
				google_id: googleSub,
				avatar_url: profile.picture || null,
				role: isSuperAdmin ? "super_admin" : "user",
				intended_plan: oauth.plan && oauth.plan in PLANS ? oauth.plan : null,
				created_at: new Date().toISOString(),
			})
			.execute();
		await startTrial(db, userId);
		try {
			await recordReferralSignup(db, oauth.ref, userId);
		} catch (err) {
			console.error("[auth] referral tracking failed:", err);
		}
		if (superAdminEmail && !isSuperAdmin) {
			c.executionCtx.waitUntil(
				sendNewSignupAlert(
					superAdminEmail,
					{ name, email: googleEmail, via: "google" },
					c.env.EMAIL,
				),
			);
		}
	}

	const key = await issueSessionToken(db, userId);
	// Client fetches the user from /auth/me; native apps get their own callback.
	return c.redirect(`${oauth.redirect ?? `${origin}/`}#token=${encodeURIComponent(key)}`);
});

// GET /auth/me — return current user info for the presented session token
authRoutes.get("/me", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = await resolveTokenUserId(db, c.req.header("Authorization"));
	if (!userId) return c.json({ error: "Unauthorized", success: false }, 401);
	const user = await db
		.selectFrom("users")
		.select(["id", "name", "email", "role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found", success: false }, 404);
	return c.json({
		data: { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
		success: true,
	});
});

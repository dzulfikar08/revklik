import { Hono } from "hono";
import type { Env } from "../types";
import { generateApiKey, generateId, hashPassword, hashToken } from "../utils";

export const authRoutes = new Hono<Env>();

// POST /auth/register — with referral tracking
authRoutes.post("/register", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const { name, email, password } = await c.req.json();
	if (!name || !email || !password)
		return c.json({ error: "All fields required", success: false }, 400);

	const existing = await db
		.selectFrom("users")
		.select(["id"])
		.where("email", "=", email)
		.executeTakeFirst();
	if (existing) return c.json({ error: "Email taken", success: false }, 409);

	const superAdminEmail = c.env.SUPER_ADMIN_EMAIL || "";
	const userId = generateId();
	await db
		.insertInto("users")
		.values({
			id: userId,
			email,
			password_hash: await hashPassword(password),
			name,
			role: email === superAdminEmail ? "super_admin" : "user",
			created_at: new Date().toISOString(),
		})
		.execute();
	const { key, prefix } = generateApiKey("session");
	await db
		.insertInto("api_keys")
		.values({
			id: generateId(),
			user_id: userId,
			key_hash: await hashToken(key),
			key_prefix: prefix,
			name: "default",
			token_type: "session",
			scopes: null,
			site_id: null,
			last_used_at: null,
			expires_at: null,
			created_at: new Date().toISOString(),
		})
		.execute();

	// Referral tracking: check for ref code in query or body
	const refCode = c.req.query("ref");
	if (refCode) {
		try {
			const affiliate = await db
				.selectFrom("affiliates")
				.select(["id", "commission_rate"])
				.where("referral_code", "=", refCode)
				.executeTakeFirst();
			if (affiliate) {
				await db
					.insertInto("referrals")
					.values({
						id: generateId(),
						affiliate_id: affiliate.id,
						referred_user_id: userId,
						event: "signup",
						commission_amount: 0,
						status: "confirmed",
						created_at: new Date().toISOString(),
					})
					.execute();
			}
		} catch {
			/* referral tracking failure should not block registration */
		}
	}

	// Create 7-day free trial subscription (Starter plan)
	const now = new Date();
	const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
	await db
		.insertInto("subscriptions")
		.values({
			id: generateId(),
			user_id: userId,
			plan: "starter",
			status: "trialing",
			current_period_start: now.toISOString(),
			current_period_end: trialEnd.toISOString(),
			cancel_at_period_end: 0,
			polar_subscription_id: null,
			polar_customer_id: null,
			created_at: now.toISOString(),
			updated_at: now.toISOString(),
		})
		.execute();

	return c.json(
		{
			data: {
				user: {
					id: userId,
					name,
					email,
					role: email === superAdminEmail ? "super_admin" : "user",
				},
				token: key,
			},
			success: true,
		},
		201,
	);
});

// POST /auth/login
authRoutes.post("/login", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const { email, password } = await c.req.json();
	const user = await db
		.selectFrom("users")
		.select(["id", "name", "email", "password_hash", "role"])
		.where("email", "=", email)
		.executeTakeFirst();
	if (!user || (await hashPassword(password)) !== user.password_hash)
		return c.json({ error: "Invalid credentials", success: false }, 401);

	const { key } = generateApiKey("session");
	await db
		.insertInto("api_keys")
		.values({
			id: generateId(),
			user_id: user.id,
			key_hash: await hashToken(key),
			key_prefix: key.slice(0, 7),
			name: "session",
			token_type: "session",
			scopes: null,
			site_id: null,
			last_used_at: null,
			expires_at: null,
			created_at: new Date().toISOString(),
		})
		.execute();
	return c.json({
		data: {
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			},
			token: key,
		},
		success: true,
	});
});

// GET /auth/google — initiate Google OAuth flow
authRoutes.get("/google", (c) => {
	const clientId = c.env.GOOGLE_CLIENT_ID || "";
	const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
	const state = crypto.randomUUID();
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "openid email profile",
		state,
		access_type: "offline",
		prompt: "consent",
	});
	return c.redirect(
		`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
	);
});

// GET /auth/google/callback — Google OAuth callback
authRoutes.get("/google/callback", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const code = c.req.query("code");
	const state = c.req.query("state");
	if (!code || !state)
		return c.json({ error: "Missing code or state", success: false }, 400);

	const clientId = c.env.GOOGLE_CLIENT_ID || "";
	const clientSecret = c.env.GOOGLE_CLIENT_SECRET || "";
	const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;

	// Exchange code for tokens
	let tokenRes: {
		access_token?: string;
		error?: string;
		error_description?: string;
	};
	try {
		const tr = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
			}),
		});
		tokenRes = await tr.json();
	} catch {
		return c.json(
			{ error: "OAuth token exchange failed", success: false },
			500,
		);
	}
	if (tokenRes.error)
		return c.json(
			{ error: tokenRes.error_description || tokenRes.error, success: false },
			400,
		);

	// Get user profile
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
	if (!profile.email)
		return c.json({ error: "No email from Google", success: false }, 400);

	const googleEmail = profile.email;
	const googleSub = profile.sub ?? null;
	const superAdminEmail = c.env.SUPER_ADMIN_EMAIL || "";
	const isSuperAdmin = googleEmail === superAdminEmail;

	// Find existing user by google_id or email
	const existingUser = await db
		.selectFrom("users")
		.select(["id", "email", "name", "role", "google_id", "avatar_url"])
		.where((eb) =>
			eb.or([
				googleSub
					? eb("google_id", "=", googleSub)
					: eb("id", "=", "__never__"),
				eb("email", "=", googleEmail),
			]),
		)
		.executeTakeFirst();

	let userId: string;
	if (existingUser) {
		userId = existingUser.id;
		// Link google_id if logging in by email for the first time
		if (!existingUser.google_id && googleSub) {
			await db
				.updateTable("users")
				.set({
					google_id: googleSub,
					avatar_url: profile.picture || existingUser.avatar_url,
				})
				.where("id", "=", userId)
				.execute();
		}
		// Promote to super_admin if email matches
		if (isSuperAdmin && existingUser.role !== "super_admin") {
			await db
				.updateTable("users")
				.set({ role: "super_admin" })
				.where("id", "=", userId)
				.execute();
		}
	} else {
		userId = generateId();
		await db
			.insertInto("users")
			.values({
				id: userId,
				email: googleEmail,
				name:
					profile.name || googleEmail.split("@")[0] || googleEmail,
				password_hash: "",
				google_id: googleSub,
				avatar_url: profile.picture || null,
				role: isSuperAdmin ? "super_admin" : "user",
				created_at: new Date().toISOString(),
			})
			.execute();

		// Create 7-day free trial subscription (Starter plan)
		const now = new Date();
		const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
		await db
			.insertInto("subscriptions")
			.values({
				id: generateId(),
				user_id: userId,
				plan: "starter",
				status: "trialing",
				current_period_start: now.toISOString(),
				current_period_end: trialEnd.toISOString(),
				cancel_at_period_end: 0,
				polar_subscription_id: null,
				polar_customer_id: null,
				created_at: now.toISOString(),
				updated_at: now.toISOString(),
			})
			.execute();
	}

	// Issue API key
	const { key } = generateApiKey("session");
	await db
		.insertInto("api_keys")
		.values({
			id: generateId(),
			user_id: userId,
			key_hash: await hashToken(key),
			key_prefix: key.slice(0, 7),
			name: "session",
			token_type: "session",
			scopes: null,
			site_id: null,
			last_used_at: null,
			expires_at: null,
			created_at: new Date().toISOString(),
		})
		.execute();

	// Redirect to app with token only — client fetches user from /auth/me
	const appUrl = `${new URL(c.req.url).origin}/#token=${encodeURIComponent(key)}`;
	return c.redirect(appUrl);
});

// GET /auth/me — return current user info based on session token
authRoutes.get("/me", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized", success: false }, 401);
	const user = await db
		.selectFrom("users")
		.select(["id", "name", "email", "role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found", success: false }, 404);
	return c.json({
		data: {
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			},
		},
		success: true,
	});
});

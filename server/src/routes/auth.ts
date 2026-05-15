import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { hashPassword, generateId, generateApiKey, hashToken } from "../utils";

type Bindings = Record<string, any>;
type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = { Bindings: Bindings; Variables: Variables };

export const authRoutes = new Hono<Env>();

// POST /auth/register — with referral tracking
authRoutes.post("/register", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const { name, email, password } = await c.req.json();
  if (!name || !email || !password) return c.json({ error: "All fields required", success: false }, 400);

  const existing = await db.selectFrom("users").select(["id"]).where("email", "=", email).executeTakeFirst();
  if (existing) return c.json({ error: "Email taken", success: false }, 409);

  const superAdminEmail = (c.env as any).SUPER_ADMIN_EMAIL || "";
  const userId = generateId();
  await db.insertInto("users").values({
    id: userId, email, password_hash: await hashPassword(password), name,
    role: email === superAdminEmail ? "super_admin" : "user",
    created_at: new Date().toISOString(),
  }).execute();
  const { key, prefix } = generateApiKey("session");
  await db.insertInto("api_keys").values({ id: generateId(), user_id: userId, key_hash: await hashToken(key), key_prefix: prefix, name: "default", token_type: "session", scopes: null, site_id: null, last_used_at: null, expires_at: null, created_at: new Date().toISOString() }).execute();

  // Referral tracking: check for ref code in query or body
  const refCode = c.req.query("ref");
  if (refCode) {
    try {
      const affiliate = await db.selectFrom("affiliates").select(["id", "commission_rate"]).where("referral_code", "=", refCode).executeTakeFirst();
      if (affiliate) {
        await db.insertInto("referrals").values({
          id: generateId(),
          affiliate_id: affiliate.id,
          referred_user_id: userId,
          event: "signup",
          commission_amount: 0,
          status: "confirmed",
          created_at: new Date().toISOString(),
        }).execute();
      }
    } catch { /* referral tracking failure should not block registration */ }
  }

  return c.json({ data: { user: { id: userId, name, email }, token: key }, success: true }, 201);
});

// POST /auth/login
authRoutes.post("/login", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const { email, password } = await c.req.json();
  const user = await db.selectFrom("users").select(["id", "name", "email", "password_hash"]).where("email", "=", email).executeTakeFirst();
  if (!user || (await hashPassword(password)) !== user.password_hash) return c.json({ error: "Invalid credentials", success: false }, 401);

  const { key } = generateApiKey("session");
  await db.insertInto("api_keys").values({ id: generateId(), user_id: user.id, key_hash: await hashToken(key), key_prefix: key.slice(0, 7), name: "session", token_type: "session", scopes: null, site_id: null, last_used_at: null, expires_at: null, created_at: new Date().toISOString() }).execute();
  return c.json({ data: { user: { id: user.id, name: user.name, email: user.email }, token: key }, success: true });
});

// GET /auth/google — initiate Google OAuth flow
authRoutes.get("/google", (c) => {
  const clientId = (c.env as any).GOOGLE_CLIENT_ID || "";
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
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /auth/google/callback — Google OAuth callback
authRoutes.get("/google/callback", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "Missing code or state", success: false }, 400);

  const clientId = (c.env as any).GOOGLE_CLIENT_ID || "";
  const clientSecret = (c.env as any).GOOGLE_CLIENT_SECRET || "";
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;

  // Exchange code for tokens
  let tokenRes: any;
  try {
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    tokenRes = await tr.json();
  } catch { return c.json({ error: "OAuth token exchange failed", success: false }, 500); }
  if (tokenRes.error) return c.json({ error: tokenRes.error_description || tokenRes.error, success: false }, 400);

  // Get user profile
  let profile: any;
  try {
    const pr = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenRes.access_token}` },
    });
    profile = await pr.json();
  } catch { return c.json({ error: "Failed to get profile", success: false }, 500); }
  if (!profile.email) return c.json({ error: "No email from Google", success: false }, 400);

  const superAdminEmail = (c.env as any).SUPER_ADMIN_EMAIL || "";
  const isSuperAdmin = profile.email === superAdminEmail;

  // Find existing user by google_id or email
  const existingByGoogle = profile.sub ? await db.selectFrom("users").selectAll().where("google_id", "=", profile.sub).executeTakeFirst() : null;
  const existingByEmail = await db.selectFrom("users").selectAll().where("email", "=", profile.email).executeTakeFirst();
  const existingUser = existingByGoogle || existingByEmail;

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    // Link google_id if logging in by email for the first time
    if (!existingUser.google_id && profile.sub) {
      await db.updateTable("users").set({ google_id: profile.sub, avatar_url: profile.picture || existingUser.avatar_url }).where("id", "=", userId).execute();
    }
    // Promote to super_admin if email matches
    if (isSuperAdmin && existingUser.role !== "super_admin") {
      await db.updateTable("users").set({ role: "super_admin" }).where("id", "=", userId).execute();
    }
  } else {
    userId = generateId();
    await db.insertInto("users").values({
      id: userId,
      email: profile.email,
      name: profile.name || profile.email.split("@")[0],
      password_hash: "",
      google_id: profile.sub || null,
      avatar_url: profile.picture || null,
      role: isSuperAdmin ? "super_admin" : "user",
      created_at: new Date().toISOString(),
    }).execute();
  }

  // Issue API key
  const { key } = generateApiKey("session");
  await db.insertInto("api_keys").values({
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
  }).execute();

  // Redirect to app with token
  const appUrl = `${new URL(c.req.url).origin}/#token=${encodeURIComponent(key)}`;
  return c.redirect(appUrl);
});

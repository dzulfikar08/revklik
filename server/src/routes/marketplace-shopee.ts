import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId, hashToken } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
export const shopeeRoutes = new Hono<{ Variables: Variables }>();

// Auth middleware for protected routes (sync, orders)
shopeeRoutes.use("/sync/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return c.json({ error: "Unauthorized", success: false }, 401);
  const token = authHeader.slice(7);
  const db = c.get("db");
  if (!db) return c.json({ error: "Database unavailable", success: false }, 503);
  const keyHash = await hashToken(token);
  const apiKey = await db.selectFrom("api_keys").select(["user_id"]).where("key_hash", "=", keyHash).executeTakeFirst();
  if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);
  c.set("userId", apiKey.user_id);
  await next();
});

shopeeRoutes.use("/orders/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return c.json({ error: "Unauthorized", success: false }, 401);
  const token = authHeader.slice(7);
  const db = c.get("db");
  if (!db) return c.json({ error: "Database unavailable", success: false }, 503);
  const keyHash = await hashToken(token);
  const apiKey = await db.selectFrom("api_keys").select(["user_id"]).where("key_hash", "=", keyHash).executeTakeFirst();
  if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);
  c.set("userId", apiKey.user_id);
  await next();
});

/** Generate Shopee API HMAC-SHA256 signature */
async function generateShopeeSign(partnerId: number, path: string, accessToken: string, timestamp: number): Promise<string> {
  const baseString = `${partnerId}${path}${timestamp}${accessToken}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(baseString);
  // In production, use env.SHOPEE_PARTNER_KEY. Here we use a placeholder.
  const keyMaterial = encoder.encode("shopee_partner_key_placeholder");
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Validate user owns the site */
async function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
  return db.selectFrom("sites").select(["id", "domain"]).where("id", "=", siteId)
    .where((eb) =>
      eb.or([
        eb("user_id", "=", userId),
        eb.exists(
          eb.selectFrom("team_members").select("id").where("site_id", "=", siteId).where("user_id", "=", userId).where("accepted_at", "is not", null)
        ),
      ])
    )
    .executeTakeFirst();
}

// GET /auth - Start Shopee OAuth flow
shopeeRoutes.get("/auth", async (c) => {
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const partnerId = Number((c.env as any).SHOPEE_PARTNER_ID || "0");
  const redirectUri = `${new URL(c.req.url).origin}/api/marketplace/shopee/callback`;
  const state = JSON.stringify({ site_id: siteId, nonce: crypto.randomUUID() });
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/shop/auth_partner";
  const sign = await generateShopeeSign(partnerId, path, "", timestamp);

  const params = new URLSearchParams({
    partner_id: String(partnerId),
    redirect: redirectUri,
    timestamp: String(timestamp),
    sign,
    state,
  });

  return c.redirect(`https://partner.shopeemobile.com${path}?${params.toString()}`);
});

// GET /callback - Handle Shopee OAuth callback
shopeeRoutes.get("/callback", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const code = c.req.query("code");
  const stateStr = c.req.query("state");
  if (!code || !stateStr) return c.json({ error: "Missing code or state", success: false }, 400);

  let state: { site_id: string; nonce: string };
  try {
    state = JSON.parse(stateStr);
  } catch {
    return c.json({ error: "Invalid state parameter", success: false }, 400);
  }
  if (!state.site_id) return c.json({ error: "Missing site_id in state", success: false }, 400);

  const partnerId = Number((c.env as any).SHOPEE_PARTNER_ID || "0");
  const timestamp = Math.floor(Date.now() / 1000);
  const tokenPath = "/api/v2/auth/token/get";
  const sign = await generateShopeeSign(partnerId, tokenPath, "", timestamp);

  // Exchange authorization code for access token
  let tokenRes: Record<string, any>;
  try {
    const tr = await fetch(`https://partner.shopeemobile.com${tokenPath}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, shop_id: Number((c.env as any).SHOPEE_SHOP_ID || "0"), partner_id: partnerId }),
    });
    tokenRes = (await tr.json()) as Record<string, any>;
  } catch {
    return c.json({ error: "Shopee token exchange failed", success: false }, 500);
  }

  if (tokenRes.error) {
    return c.json({ error: tokenRes.message || tokenRes.error, success: false }, 400);
  }

  const accessToken = tokenRes.access_token as string;
  const refreshToken = tokenRes.refresh_token as string | undefined;
  const shopId = tokenRes.shop_id as number | undefined;

  if (!accessToken) {
    return c.json({ error: "No access token received from Shopee", success: false }, 400);
  }

  // Store as integration
  const siteId = state.site_id;
  const config = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken || "",
    shop_id: shopId || 0,
    partner_id: partnerId,
    expire_time: tokenRes.expire_in ? Date.now() + (tokenRes.expire_in as number) * 1000 : null,
  });

  const existing = await db.selectFrom("integrations").select(["id"])
    .where("site_id", "=", siteId)
    .where("type", "=", "shopee")
    .executeTakeFirst();

  if (existing) {
    await db.updateTable("integrations").set({ config, last_sync: new Date().toISOString() }).where("id", "=", existing.id).execute();
  } else {
    await db.insertInto("integrations").values({
      id: generateId(),
      site_id: siteId,
      user_id: "",
      type: "shopee",
      name: "Shopee",
      config,
      enabled: 1,
      last_sync: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).execute();
  }

  // Redirect back to client integrations page
  const appUrl = `${new URL(c.req.url).origin}/integrations`;
  return c.redirect(appUrl);
});

// POST /sync - Fetch recent orders from Shopee and upsert into marketplace_orders
shopeeRoutes.post("/sync", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  // Get Shopee integration config
  const integration = await db.selectFrom("integrations").select(["id", "config"])
    .where("site_id", "=", siteId)
    .where("type", "=", "shopee")
    .executeTakeFirst();

  if (!integration) return c.json({ error: "Shopee not connected. Please authorize first.", success: false }, 404);

  const config = JSON.parse((integration.config as string) || "{}");
  const { access_token, shop_id, partner_id } = config;

  if (!access_token) {
    return c.json({ error: "Missing Shopee access token. Please re-authorize.", success: false }, 400);
  }

  const partnerId = Number((c.env as any).SHOPEE_PARTNER_ID || partner_id || "0");
  const timestamp = Math.floor(Date.now() / 1000);
  const orderPath = "/api/v2/order/get_order_list";
  const sign = await generateShopeeSign(partnerId, orderPath, access_token, timestamp);

  // Fetch orders from last 15 days
  const timeFrom = Math.floor((Date.now() - 15 * 86400000) / 1000);
  const timeTo = timestamp;

  let orderRes: Record<string, any>;
  try {
    const res = await fetch(
      `https://partner.shopeemobile.com${orderPath}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&access_token=${access_token}&shop_id=${shop_id}&time_range_field=create_time&time_from=${timeFrom}&time_to=${timeTo}&page_size=50&order_status=all`,
      { headers: { "Content-Type": "application/json" } }
    );
    orderRes = (await res.json()) as Record<string, any>;
  } catch {
    return c.json({ error: "Failed to fetch orders from Shopee API", success: false }, 502);
  }

  if (orderRes.error) {
    return c.json({ error: orderRes.message || orderRes.error, success: false }, 502);
  }

  const orderList: Array<Record<string, any>> = orderRes.response?.order_list || [];
  let synced = 0;
  let skipped = 0;

  for (const order of orderList) {
    const orderSn = order.order_sn || "";
    if (!orderSn) { skipped++; continue; }

    // Check for duplicate
    const existing = await db.selectFrom("marketplace_orders").select(["id"])
      .where("site_id", "=", siteId)
      .where("marketplace", "=", "shopee")
      .where("order_sn", "=", orderSn)
      .executeTakeFirst();

    const amount = Number(order.total_amount || 0);
    const status = order.order_status || "pending";
    const orderedAt = order.create_time ? new Date(order.create_time * 1000).toISOString() : new Date().toISOString();
    const buyerInfo = JSON.stringify({
      username: order.buyer_username || null,
      user_id: order.buyer_user_id || null,
    });
    const items = Array.isArray(order.item_list) ? JSON.stringify(order.item_list) : null;

    if (existing) {
      await db.updateTable("marketplace_orders").set({
        amount,
        status,
        buyer_info: buyerInfo,
        items,
        synced_at: new Date().toISOString(),
      }).where("id", "=", existing.id).execute();
      synced++;
    } else {
      await db.insertInto("marketplace_orders").values({
        id: generateId(),
        site_id: siteId,
        marketplace: "shopee",
        order_id: order.order_id?.toString() || orderSn,
        order_sn: orderSn,
        amount,
        currency: order.currency || "IDR",
        status,
        buyer_info: buyerInfo,
        items,
        ordered_at: orderedAt,
        synced_at: new Date().toISOString(),
      }).execute();
      synced++;
    }
  }

  // Update integration last_sync
  await db.updateTable("integrations").set({ last_sync: new Date().toISOString() }).where("id", "=", integration.id).execute();

  return c.json({ data: { synced, skipped, total: orderList.length }, success: true });
});

// GET /orders - Return stored marketplace orders for the site
shopeeRoutes.get("/orders", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");

  let query = db.selectFrom("marketplace_orders")
    .select(["id", "site_id", "marketplace", "order_id", "order_sn", "amount", "currency", "status", "buyer_info", "items", "ordered_at", "synced_at"])
    .where("site_id", "=", siteId)
    .where("marketplace", "=", "shopee")
    .orderBy("ordered_at", "desc")
    .limit(200);

  if (startDate) {
    query = query.where("ordered_at", ">=", startDate);
  }
  if (endDate) {
    query = query.where("ordered_at", "<=", endDate);
  }

  const orders = await query.execute();

  return c.json({ data: orders, success: true });
});

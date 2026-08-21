import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { generateId, hashToken } from "../utils";

export const tokopediaRoutes = new Hono<Env>();

// Subset of a Tokopedia order list item read by the sync handler.
interface TokopediaOrderListItem {
	order_id?: string | number;
	invoice_ref?: string;
	order_status?: string;
	status?: string;
	total_price?: number | string;
	create_time?: number | string;
	created_at?: string;
	buyer_name?: string;
	buyer?: {
		name?: string | null;
		email?: string | null;
		phone?: string | null;
	} | null;
	payment?: { amount?: number | string };
	products?: unknown[];
	items?: unknown[];
}

// Auth middleware for protected routes (sync, orders)
tokopediaRoutes.use("/sync/*", async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer "))
		return c.json({ error: "Unauthorized", success: false }, 401);
	const token = authHeader.slice(7);
	const db = c.get("db");
	if (!db)
		return c.json({ error: "Database unavailable", success: false }, 503);
	const keyHash = await hashToken(token);
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["user_id"])
		.where("key_hash", "=", keyHash)
		.executeTakeFirst();
	if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);
	c.set("userId", apiKey.user_id);
	await next();
});

tokopediaRoutes.use("/orders/*", async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer "))
		return c.json({ error: "Unauthorized", success: false }, 401);
	const token = authHeader.slice(7);
	const db = c.get("db");
	if (!db)
		return c.json({ error: "Database unavailable", success: false }, 503);
	const keyHash = await hashToken(token);
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["user_id"])
		.where("key_hash", "=", keyHash)
		.executeTakeFirst();
	if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);
	c.set("userId", apiKey.user_id);
	await next();
});

/** Validate user owns the site */
async function validateSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
) {
	return db
		.selectFrom("sites")
		.select(["id", "domain"])
		.where("id", "=", siteId)
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.where("site_id", "=", siteId)
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null),
				),
			]),
		)
		.executeTakeFirst();
}

// GET /auth - Start Tokopedia OAuth flow
tokopediaRoutes.get("/auth", async (c) => {
	const siteId = c.req.query("site_id");
	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const clientId = c.env.TOKOPEDIA_CLIENT_ID || "";
	const redirectUri = `${new URL(c.req.url).origin}/api/marketplace/tokopedia/callback`;
	const state = JSON.stringify({ site_id: siteId, nonce: crypto.randomUUID() });

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "order.read shop.read",
		state,
	});

	return c.redirect(
		`https://accounts.tokopedia.com/oauth/authorize?${params.toString()}`,
	);
});

// GET /callback - Handle Tokopedia OAuth callback
tokopediaRoutes.get("/callback", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const code = c.req.query("code");
	const stateStr = c.req.query("state");
	if (!code || !stateStr)
		return c.json({ error: "Missing code or state", success: false }, 400);

	let state: { site_id: string; nonce: string };
	try {
		state = JSON.parse(stateStr);
	} catch {
		return c.json({ error: "Invalid state parameter", success: false }, 400);
	}
	if (!state.site_id)
		return c.json({ error: "Missing site_id in state", success: false }, 400);

	const clientId = c.env.TOKOPEDIA_CLIENT_ID || "";
	const clientSecret = c.env.TOKOPEDIA_CLIENT_SECRET || "";
	const redirectUri = `${new URL(c.req.url).origin}/api/marketplace/tokopedia/callback`;

	// Exchange authorization code for access token using Basic auth
	let tokenRes: {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		shop_id?: number | string;
		error?: string;
		error_description?: string;
	};
	try {
		const basicAuth = btoa(`${clientId}:${clientSecret}`);
		const tr = await fetch("https://accounts.tokopedia.com/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${basicAuth}`,
			},
			body: new URLSearchParams({
				code,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
			}),
		});
		tokenRes = (await tr.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
			shop_id?: number | string;
			error?: string;
			error_description?: string;
		};
	} catch {
		return c.json(
			{ error: "Tokopedia token exchange failed", success: false },
			500,
		);
	}

	if (tokenRes.error) {
		return c.json(
			{ error: tokenRes.error_description || tokenRes.error, success: false },
			400,
		);
	}

	const accessToken = tokenRes.access_token as string;
	const refreshToken = tokenRes.refresh_token as string | undefined;

	if (!accessToken) {
		return c.json(
			{ error: "No access token received from Tokopedia", success: false },
			400,
		);
	}

	// Store as integration
	const siteId = state.site_id;
	const config = JSON.stringify({
		access_token: accessToken,
		refresh_token: refreshToken || "",
		expire_time: tokenRes.expires_in
			? Date.now() + tokenRes.expires_in * 1000
			: null,
		shop_id: tokenRes.shop_id || null,
	});

	const existing = await db
		.selectFrom("integrations")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("type", "=", "tokopedia")
		.executeTakeFirst();

	if (existing) {
		await db
			.updateTable("integrations")
			.set({ config, last_sync: new Date().toISOString() })
			.where("id", "=", existing.id)
			.execute();
	} else {
		await db
			.insertInto("integrations")
			.values({
				id: generateId(),
				site_id: siteId,
				user_id: "",
				type: "tokopedia",
				name: "Tokopedia",
				config,
				enabled: 1,
				last_sync: new Date().toISOString(),
				created_at: new Date().toISOString(),
			})
			.execute();
	}

	// Redirect back to client integrations page
	const appUrl = `${new URL(c.req.url).origin}/integrations`;
	return c.redirect(appUrl);
});

// POST /sync - Fetch recent orders from Tokopedia and upsert into marketplace_orders
tokopediaRoutes.post("/sync", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const siteId = c.req.query("site_id");
	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	// Get Tokopedia integration config
	const integration = await db
		.selectFrom("integrations")
		.select(["id", "config"])
		.where("site_id", "=", siteId)
		.where("type", "=", "tokopedia")
		.executeTakeFirst();

	if (!integration)
		return c.json(
			{
				error: "Tokopedia not connected. Please authorize first.",
				success: false,
			},
			404,
		);

	const config = JSON.parse((integration.config as string) || "{}");
	const { access_token, shop_id } = config;

	if (!access_token) {
		return c.json(
			{
				error: "Missing Tokopedia access token. Please re-authorize.",
				success: false,
			},
			400,
		);
	}

	// Fetch orders from Tokopedia API using Bearer token auth
	const fromTime = new Date(Date.now() - 15 * 86400000)
		.toISOString()
		.split("T")[0];
	const toTime = new Date().toISOString().split("T")[0];

	let orderRes: {
		error_msg?: string;
		data?:
			| {
					order_data?: TokopediaOrderListItem[];
			  }
			| TokopediaOrderListItem[];
	};
	try {
		const fsId = c.env.TOKOPEDIA_FS_ID || shop_id || "0";
		const res = await fetch(
			`https://fs.tokopedia.net/v2/order/list?fs_id=${fsId}&from_date=${fromTime}&to_date=${toTime}&page=1&per_page=50`,
			{
				headers: {
					Authorization: `Bearer ${access_token}`,
					"Content-Type": "application/json",
				},
			},
		);
		orderRes = (await res.json()) as {
			error_msg?: string;
			data?:
				| {
						order_data?: TokopediaOrderListItem[];
				  }
				| TokopediaOrderListItem[];
		};
	} catch {
		return c.json(
			{ error: "Failed to fetch orders from Tokopedia API", success: false },
			502,
		);
	}

	if (!orderRes.data) {
		return c.json(
			{ error: orderRes.error_msg || "Tokopedia API error", success: false },
			502,
		);
	}

	const dataField = orderRes.data;
	const orderList: TokopediaOrderListItem[] = Array.isArray(dataField)
		? dataField
		: dataField.order_data || [];
	let synced = 0;
	let skipped = 0;

	for (const order of orderList) {
		const orderSn = order.order_id?.toString() || order.invoice_ref || "";
		if (!orderSn) {
			skipped++;
			continue;
		}

		// Check for duplicate
		const existing = await db
			.selectFrom("marketplace_orders")
			.select(["id"])
			.where("site_id", "=", siteId)
			.where("marketplace", "=", "tokopedia")
			.where("order_sn", "=", orderSn)
			.executeTakeFirst();

		const amount = Number(order.payment?.amount || order.total_price || 0);
		const status = order.order_status || order.status || "pending";
		const orderedAt =
			order.create_time || order.created_at || new Date().toISOString();
		const buyerInfo = JSON.stringify({
			name: order.buyer?.name || order.buyer_name || null,
			email: order.buyer?.email || null,
			phone: order.buyer?.phone || null,
		});
		const items =
			Array.isArray(order.products) || Array.isArray(order.items)
				? JSON.stringify(order.products || order.items)
				: null;

		if (existing) {
			await db
				.updateTable("marketplace_orders")
				.set({
					amount,
					status,
					buyer_info: buyerInfo,
					items,
					synced_at: new Date().toISOString(),
				})
				.where("id", "=", existing.id)
				.execute();
			synced++;
		} else {
			await db
				.insertInto("marketplace_orders")
				.values({
					id: generateId(),
					site_id: siteId,
					marketplace: "tokopedia",
					order_id: order.order_id?.toString() || orderSn,
					order_sn: orderSn,
					amount,
					currency: "IDR",
					status,
					buyer_info: buyerInfo,
					items,
					ordered_at:
						typeof orderedAt === "number"
							? new Date(orderedAt * 1000).toISOString()
							: orderedAt,
					synced_at: new Date().toISOString(),
				})
				.execute();
			synced++;
		}
	}

	// Update integration last_sync
	await db
		.updateTable("integrations")
		.set({ last_sync: new Date().toISOString() })
		.where("id", "=", integration.id)
		.execute();

	return c.json({
		data: { synced, skipped, total: orderList.length },
		success: true,
	});
});

// GET /orders - Return stored marketplace orders for the site
tokopediaRoutes.get("/orders", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const siteId = c.req.query("site_id");
	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const startDate = c.req.query("start_date");
	const endDate = c.req.query("end_date");

	let query = db
		.selectFrom("marketplace_orders")
		.select([
			"id",
			"site_id",
			"marketplace",
			"order_id",
			"order_sn",
			"amount",
			"currency",
			"status",
			"buyer_info",
			"items",
			"ordered_at",
			"synced_at",
		])
		.where("site_id", "=", siteId)
		.where("marketplace", "=", "tokopedia")
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

import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import { sql } from "../db";
import { backupDatabase } from "../backup";
import type { Bindings } from "../types";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = { Bindings: Bindings; Variables: Variables };

export const adminRoutes = new Hono<Env>();

// GET /admin/stats — system-wide statistics (super_admin only)
adminRoutes.get("/stats", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const [users, sites, events, subscriptions] = await Promise.all([
		db
			.selectFrom("users")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.executeTakeFirst(),
		db
			.selectFrom("sites")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.executeTakeFirst(),
		db
			.selectFrom("events")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.executeTakeFirst(),
		db
			.selectFrom("subscriptions")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.where("status", "=", "active")
			.executeTakeFirst(),
	]);
	return c.json({
		data: {
			users: Number(users?.count ?? 0),
			sites: Number(sites?.count ?? 0),
			events: Number(events?.count ?? 0),
			activeSubscriptions: Number(subscriptions?.count ?? 0),
		},
		success: true,
	});
});

// POST /admin/backup — run the R2 snapshot immediately (super_admin only).
// The daily cron uses the same code path; this makes backup health observable.
adminRoutes.post("/backup", async (c) => {
	const env = c.env;
	if (!env?.DB || !env?.BACKUP_BUCKET) {
		return c.json({ error: "DB or BACKUP_BUCKET binding missing", success: false }, 503);
	}
	try {
		await backupDatabase(env);
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "backup failed", success: false },
			500,
		);
	}
	return c.json({ success: true });
});

// GET /admin/users — list users (super_admin only)
adminRoutes.get("/users", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const users = await db
		.selectFrom("users")
		.select(["id", "email", "name", "role", "google_id", "created_at"])
		.orderBy("created_at", "desc")
		.limit(200)
		.execute();
	return c.json({ data: users, success: true });
});

// GET /admin/members — full member roster for the admin view: identity,
// subscription state, registered sites, and event activity per member.
adminRoutes.get("/members", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const [users, subs, sites, eventStats] = await Promise.all([
		db
			.selectFrom("users")
			.select(["id", "email", "name", "role", "created_at"])
			.orderBy("created_at", "desc")
			.limit(500)
			.execute(),
		db
			.selectFrom("subscriptions")
			.select(["user_id", "plan", "status", "current_period_end", "pakasir_order_id"])
			.execute(),
		db
			.selectFrom("sites")
			.select(["id", "user_id", "domain", "created_at"])
			.orderBy("created_at", "desc")
			.execute(),
		db
			.selectFrom("events")
			.innerJoin("sites", "sites.id", "events.site_id")
			.select([
				"sites.user_id",
				({ fn }) => fn.count<number>("events.id").as("total"),
				sql<number>`SUM(CASE WHEN events.timestamp >= datetime('now', '-30 days') THEN 1 ELSE 0 END)`.as(
					"last30d",
				),
				({ fn }) => fn.max("events.timestamp").as("last_event"),
			])
			.groupBy("sites.user_id")
			.execute(),
	]);

	const subByUser: Record<string, (typeof subs)[number]> = Object.fromEntries(
		subs.map((s) => [s.user_id, s]),
	);
	const eventByUser: Record<string, (typeof eventStats)[number]> = Object.fromEntries(
		eventStats.map((e) => [e.user_id, e]),
	);
	const sitesByUser: Record<string, { id: string; domain: string; created_at: string }[]> = {};
	for (const site of sites) {
		(sitesByUser[site.user_id] ??= []).push({
			id: site.id,
			domain: site.domain,
			created_at: site.created_at,
		});
	}

	const members = users.map((u) => {
		const sub = subByUser[u.id];
		const ev = eventByUser[u.id];
		return {
			...u,
			plan: sub?.plan ?? "micro",
			subscription_status: sub?.status ?? "none",
			period_end: sub?.current_period_end ?? null,
			awaiting_payment: Boolean(sub?.pakasir_order_id) && sub?.status === "pending",
			sites: sitesByUser[u.id] ?? [],
			events_total: Number(ev?.total ?? 0),
			events_last_30d: Number(ev?.last30d ?? 0),
			last_event_at: ev?.last_event ?? null,
		};
	});
	return c.json({ data: members, success: true });
});

// PATCH /admin/users/:id — update user role/plan (super_admin only)
adminRoutes.patch("/users/:id", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const targetId = c.req.param("id");
	const body = await c.req.json();
	const updates: Record<string, unknown> = {};
	if (body.role !== undefined) updates.role = body.role;
	if (body.plan !== undefined) {
		// Upsert subscription plan
		await db
			.insertInto("subscriptions")
			.values({
				id: generateId(),
				user_id: targetId,
				plan: body.plan,
				status: "active",
				current_period_start: new Date().toISOString(),
				current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
				cancel_at_period_end: 0,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.onConflict((oc) =>
				oc.column("user_id").doUpdateSet({
					plan: body.plan,
					updated_at: new Date().toISOString(),
				}),
			)
			.execute();
	}
	if (Object.keys(updates).length > 0) {
		await db.updateTable("users").set(updates).where("id", "=", targetId).execute();
	}
	return c.json({ success: true });
});

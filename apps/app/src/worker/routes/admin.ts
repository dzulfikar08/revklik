import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = { Variables: Variables };

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

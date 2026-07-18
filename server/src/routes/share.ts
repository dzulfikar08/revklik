import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const shareRoutes = new Hono<{ Variables: Variables }>();

// Toggle public dashboard on/off
shareRoutes.post("/:siteId/toggle", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");

	const site = await db
		.selectFrom("sites")
		.select(["id", "share_token", "public_dashboard"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const isPublic = site.public_dashboard === 1;
	if (isPublic) {
		await db
			.updateTable("sites")
			.set({ public_dashboard: 0, share_token: null })
			.where("id", "=", siteId)
			.execute();
		return c.json({
			data: { public: false, share_token: null },
			success: true,
		});
	} else {
		const token = site.share_token || generateId();
		await db
			.updateTable("sites")
			.set({ public_dashboard: 1, share_token: token })
			.where("id", "=", siteId)
			.execute();
		return c.json({
			data: { public: true, share_token: token },
			success: true,
		});
	}
});

// Get share status
shareRoutes.get("/:siteId/status", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");

	const site = await db
		.selectFrom("sites")
		.select(["id", "share_token", "public_dashboard"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	return c.json({
		data: {
			public: site.public_dashboard === 1,
			share_token: site.share_token,
		},
		success: true,
	});
});

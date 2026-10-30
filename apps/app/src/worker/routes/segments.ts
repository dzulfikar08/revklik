import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { requireSiteAccess } from "../lib/site-access";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const segmentRoutes = new Hono<{ Variables: Variables }>();

segmentRoutes.get("/", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;

	const segments = await db
		.selectFrom("segments")
		.selectAll()
		.where("site_id", "=", siteId)
		.orderBy("created_at", "desc")
		.execute();
	return c.json({ data: segments, success: true });
});

segmentRoutes.post("/", async (c) => {
	const db = c.get("db");
	const { site_id, name, filters } = await c.req.json();
	if (!site_id || !name || !filters)
		return c.json({ error: "site_id, name, and filters required", success: false }, 400);

	const access = await requireSiteAccess(c, site_id, "write");
	if (access instanceof Response) return access;

	const id = generateId();
	await db
		.insertInto("segments")
		.values({
			id,
			site_id,
			name,
			filters: JSON.stringify(filters),
			created_at: new Date().toISOString(),
		})
		.execute();
	return c.json(
		{
			data: {
				id,
				site_id,
				name,
				filters,
				created_at: new Date().toISOString(),
			},
			success: true,
		},
		201,
	);
});

segmentRoutes.delete("/:segmentId", async (c) => {
	const db = c.get("db");
	const segmentId = c.req.param("segmentId");

	const segment = await db
		.selectFrom("segments")
		.select(["id", "site_id"])
		.where("id", "=", segmentId)
		.executeTakeFirst();
	if (!segment) return c.json({ error: "Segment not found", success: false }, 404);

	const access = await requireSiteAccess(c, segment.site_id, "write");
	if (access instanceof Response) return access;

	await db.deleteFrom("segments").where("id", "=", segmentId).execute();
	return c.json({ success: true });
});

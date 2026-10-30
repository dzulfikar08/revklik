import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { requireSiteAccess } from "../lib/site-access";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const annotationRoutes = new Hono<{ Variables: Variables }>();

annotationRoutes.get("/", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;

	const annotations = await db
		.selectFrom("annotations")
		.selectAll()
		.where("site_id", "=", siteId)
		.orderBy("date", "desc")
		.limit(100)
		.execute();
	return c.json({ data: annotations, success: true });
});

annotationRoutes.post("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const { site_id, date, text } = await c.req.json();
	if (!site_id || !date || !text)
		return c.json({ error: "site_id, date, and text required", success: false }, 400);

	const access = await requireSiteAccess(c, site_id, "write");
	if (access instanceof Response) return access;

	const id = generateId();
	await db
		.insertInto("annotations")
		.values({
			id,
			site_id,
			date,
			text,
			user_id: userId,
			created_at: new Date().toISOString(),
		})
		.execute();
	return c.json(
		{
			data: { id, site_id, date, text, created_at: new Date().toISOString() },
			success: true,
		},
		201,
	);
});

annotationRoutes.delete("/:annotationId", async (c) => {
	const db = c.get("db");
	const annotationId = c.req.param("annotationId");

	const annotation = await db
		.selectFrom("annotations")
		.select(["id", "site_id"])
		.where("id", "=", annotationId)
		.executeTakeFirst();
	if (!annotation) return c.json({ error: "Annotation not found", success: false }, 404);

	const access = await requireSiteAccess(c, annotation.site_id, "write");
	if (access instanceof Response) return access;

	await db.deleteFrom("annotations").where("id", "=", annotationId).execute();
	return c.json({ success: true });
});

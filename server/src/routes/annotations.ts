import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const annotationRoutes = new Hono<{ Variables: Variables }>();

function validateSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
) {
	return db
		.selectFrom("sites")
		.select(["id"])
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

annotationRoutes.get("/", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

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
		return c.json(
			{ error: "site_id, date, and text required", success: false },
			400,
		);

	const site = await validateSite(db, userId, site_id);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

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
	const userId = c.get("userId");
	const annotationId = c.req.param("annotationId");

	const annotation = await db
		.selectFrom("annotations")
		.select(["id", "site_id"])
		.where("id", "=", annotationId)
		.executeTakeFirst();
	if (!annotation)
		return c.json({ error: "Annotation not found", success: false }, 404);

	const site = await validateSite(db, userId, annotation.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	await db.deleteFrom("annotations").where("id", "=", annotationId).execute();
	return c.json({ success: true });
});

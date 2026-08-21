import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const emailReportRoutes = new Hono<{ Variables: Variables }>();

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
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

emailReportRoutes.get("/", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const reports = await db
		.selectFrom("email_reports")
		.selectAll()
		.where("site_id", "=", siteId)
		.orderBy("created_at", "desc")
		.execute();
	return c.json({ data: reports, success: true });
});

emailReportRoutes.post("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const { site_id, frequency } = await c.req.json();
	if (!site_id || !frequency)
		return c.json({ error: "site_id and frequency required", success: false }, 400);
	if (!["daily", "weekly", "monthly"].includes(frequency))
		return c.json({ error: "frequency must be daily, weekly, or monthly", success: false }, 400);

	const site = await validateSite(db, userId, site_id);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const id = generateId();
	await db
		.insertInto("email_reports")
		.values({
			id,
			site_id,
			user_id: userId,
			frequency,
			enabled: 1,
			last_sent: null,
			created_at: new Date().toISOString(),
		})
		.execute();
	return c.json(
		{
			data: {
				id,
				site_id,
				user_id: userId,
				frequency,
				enabled: 1,
				last_sent: null,
				created_at: new Date().toISOString(),
			},
			success: true,
		},
		201,
	);
});

emailReportRoutes.put("/:reportId", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const reportId = c.req.param("reportId");
	const { frequency, enabled } = await c.req.json();

	const report = await db
		.selectFrom("email_reports")
		.select(["id", "site_id"])
		.where("id", "=", reportId)
		.executeTakeFirst();
	if (!report) return c.json({ error: "Report not found", success: false }, 404);

	const site = await validateSite(db, userId, report.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	const updates: Record<string, unknown> = {};
	if (frequency !== undefined) updates.frequency = frequency;
	if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
	if (Object.keys(updates).length > 0) {
		await db.updateTable("email_reports").set(updates).where("id", "=", reportId).execute();
	}
	return c.json({ success: true });
});

emailReportRoutes.delete("/:reportId", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const reportId = c.req.param("reportId");

	const report = await db
		.selectFrom("email_reports")
		.select(["id", "site_id"])
		.where("id", "=", reportId)
		.executeTakeFirst();
	if (!report) return c.json({ error: "Report not found", success: false }, 404);

	const site = await validateSite(db, userId, report.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	await db.deleteFrom("email_reports").where("id", "=", reportId).execute();
	return c.json({ success: true });
});

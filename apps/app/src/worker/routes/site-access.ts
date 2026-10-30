import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { requireSiteAccess } from "../lib/site-access";
import { ROLE_TABLE } from "../lib/site-roles";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

/** What the signed-in caller may do on one site, so clients can hide controls they cannot use. */
export const siteAccessRoutes = new Hono<{ Variables: Variables }>();

siteAccessRoutes.get("/:siteId/access", async (c) => {
	const access = await requireSiteAccess(c, c.req.param("siteId"), "read");
	if (access instanceof Response) return access;
	// Reaching here means the caller holds a role: a stranger already got the 404 above.
	const role = access.role ?? "viewer";
	return c.json({ data: { role, can: ROLE_TABLE[role] }, success: true });
});

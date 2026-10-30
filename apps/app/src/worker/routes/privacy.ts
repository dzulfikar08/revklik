import { Hono } from "hono";
import { isSelfHosted } from "../lib/entitlement";
import { deleteAccount, eraseVisitor, exportVisitor } from "../lib/erasure";
import { resolveSession } from "../lib/session";
import { requireSiteAccess } from "../lib/site-access";
import type { Env } from "../types";
import { normalizeEmail } from "../utils";
import { requireStepUp } from "./account-links";

const POLAR_API = "https://api.polar.sh/v1";
/** Polar answers these when the subscription is already gone; the goal state is reached. */
const POLAR_ALREADY_GONE = new Set([404, 410]);

/**
 * Account erasure. Mounted on the public /auth prefix, so the session (kp_) token is
 * resolved here, like the other self-authenticating account routes.
 */
export const accountPrivacyRoutes = new Hono<Env>();

// DELETE /auth/account {confirm_email, current_password}
accountPrivacyRoutes.delete("/account", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const session = await resolveSession(db, c.req.header("Authorization"));
	if (!session) return c.json({ error: "Session token required", success: false }, 401);

	const body = await c.req.json().catch(() => ({}));
	const confirmEmail = normalizeEmail(body?.confirm_email);
	const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";

	const user = await db
		.selectFrom("users")
		.select(["id", "email"])
		.where("id", "=", session.userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "Account not found", success: false }, 404);
	if (!confirmEmail || confirmEmail !== normalizeEmail(user.email)) {
		return c.json({ error: "confirm_email_mismatch", success: false }, 400);
	}
	const stepUp = await requireStepUp(db, session, currentPassword);
	if (!stepUp.ok) return c.json({ error: stepUp.error, success: false }, stepUp.status);

	// Stop the billing first: deleting the account must never leave a subscription charging.
	const sub = await db
		.selectFrom("subscriptions")
		.select(["polar_subscription_id", "status"])
		.where("user_id", "=", user.id)
		.executeTakeFirst();
	if (sub?.polar_subscription_id && sub.status !== "canceled" && !isSelfHosted(c.env)) {
		const token = c.env.POLAR_ACCESS_TOKEN;
		let cancelled = false;
		if (token) {
			try {
				const res = await fetch(`${POLAR_API}/subscriptions/${sub.polar_subscription_id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(10_000),
				});
				cancelled = res.ok || POLAR_ALREADY_GONE.has(res.status);
				if (!cancelled) console.error(`[privacy] Polar revoke answered HTTP ${res.status}`);
			} catch (err) {
				console.error("[privacy] Polar revoke failed:", err);
			}
		}
		if (!cancelled) return c.json({ error: "billing_cancel_failed", success: false }, 502);
	}

	const result = await deleteAccount(c.env.DB, user.id, normalizeEmail(user.email));
	if (result.unfinished.length > 0) {
		return c.json(
			{ data: { status: "deleting", remaining_tables: result.unfinished }, success: true },
			202,
		);
	}
	return c.json({ success: true });
});

/** Per-visitor erasure and export for a site's owner and editors. Mounted under authMiddleware at /sites. */
export const visitorPrivacyRoutes = new Hono<Env>();

// DELETE /sites/:siteId/visitors/:visitorId
visitorPrivacyRoutes.delete("/:siteId/visitors/:visitorId", async (c) => {
	const siteId = c.req.param("siteId");
	const visitorId = c.req.param("visitorId");
	const access = await requireSiteAccess(c, siteId, "write");
	if (access instanceof Response) return access;

	const erased = await eraseVisitor(c.env.DB, siteId, visitorId);
	const touched = Object.values(erased).reduce((sum, n) => sum + n, 0);
	if (touched === 0) return c.json({ error: "Visitor not found", success: false }, 404);
	return c.json({ data: erased, success: true });
});

// GET /sites/:siteId/visitors/:visitorId/export
visitorPrivacyRoutes.get("/:siteId/visitors/:visitorId/export", async (c) => {
	const db = c.get("db");
	const siteId = c.req.param("siteId");
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;

	const data = await exportVisitor(db, siteId, c.req.param("visitorId"));
	if (!data) return c.json({ error: "Visitor not found", success: false }, 404);
	return c.json({ data, success: true });
});

import { Hono } from "hono";
import { SCOPES } from "@revklik/shared";
import { requireScope } from "../../middleware/scope-validator";
import type { PublicApiEnv } from "../../middleware/public-auth";
import {
	PublicApiError,
	assertSiteAllowed,
	assertSiteExists,
	publicApiCtx,
	publicApiErrorResponse,
} from "../../lib/public-api-queries";
import { isValidReportedNet, MAX_RAIL_LENGTH, normalizeRail } from "../../lib/fees";
import { recordServerEvent } from "../../lib/server-events";

export const v1EventsRoutes = new Hono<PublicApiEnv>();

const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 100;
const MAX_PROPS_BYTES = 4096;
const MAX_PRODUCT_LENGTH = 80;

/** A string field, trimmed, within `max` characters; undefined when absent. */
function optionalString(
	body: Record<string, unknown>,
	key: string,
	max: number,
): string | undefined {
	const value = body[key];
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new PublicApiError(400, `${key} must be a string`);
	const trimmed = value.trim();
	if (trimmed.length > max)
		throw new PublicApiError(400, `${key} is longer than ${max} characters`);
	return trimmed || undefined;
}

function requiredString(body: Record<string, unknown>, key: string, max: number): string {
	const value = optionalString(body, key, max);
	if (!value) throw new PublicApiError(400, `${key} required`);
	return value;
}

/**
 * POST /events/server: a trusted server reports a purchase, renewal or refund.
 * Body: { site_id, name, revenue, currency?, external_id, source?, props?,
 * occurred_at?, visitor_id?, session_id?, utm_source?, utm_medium?, utm_campaign?,
 * rail?, product?, net_revenue? }.
 * `revenue` is in major units and negative for refunds. `net_revenue` (same
 * currency and sign, |net| <= |revenue|) is what the merchant keeps; without it
 * RevKlik computes the net from the owner's fee rule for `rail`. Idempotent on
 * (site_id, external_id): a repeat returns duplicate:true with the original event.
 */
v1EventsRoutes.post("/server", requireScope(SCOPES.EVENTS_WRITE), async (c) => {
	try {
		const ctx = publicApiCtx(c);
		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			throw new PublicApiError(400, "Body must be JSON");
		}
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new PublicApiError(400, "Body must be a JSON object");
		}
		const body = raw as Record<string, unknown>;

		const siteId = requiredString(body, "site_id", MAX_ID_LENGTH);
		assertSiteAllowed(ctx, siteId);
		await assertSiteExists(ctx, siteId);

		const name = requiredString(body, "name", MAX_NAME_LENGTH);
		const externalId = requiredString(body, "external_id", MAX_ID_LENGTH);
		const revenue = typeof body.revenue === "string" ? Number(body.revenue) : body.revenue;
		if (typeof revenue !== "number" || !Number.isFinite(revenue) || Math.abs(revenue) > 1e9) {
			throw new PublicApiError(400, "revenue must be a number between -1e9 and 1e9");
		}

		const rawRail = optionalString(body, "rail", MAX_RAIL_LENGTH);
		const rail = rawRail === undefined ? undefined : normalizeRail(rawRail);
		if (rail === null) {
			throw new PublicApiError(400, "rail must be lowercase letters, digits, _ . or -");
		}

		let netRevenue: number | undefined;
		if (body.net_revenue !== undefined && body.net_revenue !== null && body.net_revenue !== "") {
			const net =
				typeof body.net_revenue === "string" ? Number(body.net_revenue) : body.net_revenue;
			if (typeof net !== "number" || !isValidReportedNet(revenue, net)) {
				throw new PublicApiError(
					400,
					"net_revenue must be a number with the sign of revenue and no larger in size",
				);
			}
			netRevenue = net;
		}

		let props: Record<string, unknown> | undefined;
		if (body.props !== undefined && body.props !== null) {
			if (typeof body.props !== "object" || Array.isArray(body.props)) {
				throw new PublicApiError(400, "props must be an object");
			}
			if (JSON.stringify(body.props).length > MAX_PROPS_BYTES) {
				throw new PublicApiError(400, `props is larger than ${MAX_PROPS_BYTES} bytes`);
			}
			props = body.props as Record<string, unknown>;
		}

		let occurredAt: string | number | undefined;
		if (body.occurred_at !== undefined && body.occurred_at !== null) {
			if (typeof body.occurred_at !== "string" && typeof body.occurred_at !== "number") {
				throw new PublicApiError(400, "occurred_at must be an ISO 8601 string or epoch ms");
			}
			if (!Number.isFinite(new Date(body.occurred_at).getTime())) {
				throw new PublicApiError(400, "occurred_at is not a valid date");
			}
			occurredAt = body.occurred_at;
		}

		const site = await ctx.db
			.selectFrom("sites")
			.select(["id", "revenue_currency"])
			.where("id", "=", siteId)
			.executeTakeFirstOrThrow();

		const result = await recordServerEvent(
			ctx.db,
			site,
			{
				siteId,
				name,
				revenue,
				currency: optionalString(body, "currency", 3),
				externalId,
				source: optionalString(body, "source", 40) ?? "server",
				props,
				occurredAt,
				visitorId: optionalString(body, "visitor_id", MAX_ID_LENGTH),
				sessionId: optionalString(body, "session_id", MAX_ID_LENGTH),
				utmSource: optionalString(body, "utm_source", 100),
				utmMedium: optionalString(body, "utm_medium", 100),
				utmCampaign: optionalString(body, "utm_campaign", 200),
				rail,
				product: optionalString(body, "product", MAX_PRODUCT_LENGTH),
				netRevenue,
			},
			ctx.env,
		);

		return c.json({
			success: true,
			event_id: result.eventId,
			visitor_id: result.visitorId,
			duplicate: result.duplicate,
		});
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

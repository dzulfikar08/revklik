import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import { recordServerEvent } from "./server-events";

/** The shape `crypto.randomUUID()` produces, which is what the tracker stores as `_kp_vid`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tracker visitor id from the signup link, or null when it is absent or malformed. */
export function parseVisitorId(raw: unknown): string | null {
	return typeof raw === "string" && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

export interface SignupEventInput {
	userId: string;
	method: "email" | "google";
	plan: string | null;
	/** `rk_vid` carried from the marketing site; anything not UUID-shaped is ignored. */
	visitorId?: unknown;
}

/**
 * Record `signup` as a revenue-less conversion on RevKlik's own site, so the
 * revklik.com journey (source → pricing click → /register) ends in an account.
 * No-op when REVKLIK_SELF_SITE_ID is unset (self-hosted installs) or names no
 * site. The event joins the visitor's latest session when the visitor id
 * matches a tracked one, else it stands alone under a fresh visitor id.
 * Idempotent per user. Callers fire it from waitUntil and swallow errors:
 * analytics must never fail a registration.
 */
export async function recordSignupEvent(
	db: Kysely<KlikapaDatabase>,
	env: { REVKLIK_SELF_SITE_ID?: string },
	input: SignupEventInput,
): Promise<void> {
	const siteId = env.REVKLIK_SELF_SITE_ID?.trim();
	if (!siteId) return;
	const site = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return;

	const visitorId = parseVisitorId(input.visitorId);
	const session = visitorId
		? await db
				.selectFrom("sessions")
				.select(["id"])
				.where("site_id", "=", site.id)
				.where("visitor_id", "=", visitorId)
				.orderBy("started_at", "desc")
				.limit(1)
				.executeTakeFirst()
		: undefined;

	await recordServerEvent(db, site, {
		siteId: site.id,
		name: "signup",
		revenue: 0,
		eventType: "conversion",
		externalId: `signup:${input.userId}`,
		source: "revklik",
		path: "/register",
		props: { method: input.method, plan: input.plan },
		visitorId: visitorId ?? generateId(),
		sessionId: session?.id ?? null,
	});
}

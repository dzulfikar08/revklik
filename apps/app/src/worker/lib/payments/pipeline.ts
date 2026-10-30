import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../../db";
import type { Env } from "../../types";
import { normalizeCurrency } from "../fx";
import { notifySaleEvent, pushCtx } from "../push";
import { type ServerEventResult, recordServerEvent } from "../server-events";
import { logRejectedDelivery, logWebhookEvent } from "../webhook-log";
import {
	type DeliveryContext,
	type PaymentAdapter,
	type PaymentLeg,
	type ProviderRow,
	RetryableDeliveryError,
} from "./types";

const SERVER_ERROR_BODY = { error: "Could not record the payment, the provider will retry" };
const RETRY_BODY = { error: "Provider API unavailable, retry later" };
/** Re-reads after a refund-key collision; each lap means a concurrent delivery booked first. */
const REFUND_BOOKING_ATTEMPTS = 3;
const MINOR_PER_MAJOR = 100;
const MAX_KEY_LENGTH = 150;

const keyPart = (id: string): string =>
	id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, MAX_KEY_LENGTH);

/** `events.external_id` of a provider's sale: unique per provider transaction. */
export const saleExternalId = (provider: string, saleId: string): string =>
	`${provider}:${keyPart(saleId)}`;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

function parseConfig(raw: unknown): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(typeof raw === "string" && raw ? raw : "{}");
		if (!parsed || typeof parsed !== "object") return {};
		return Object.fromEntries(
			Object.entries(parsed).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]),
		);
	} catch {
		return {};
	}
}

/** The site's own enabled row for a provider; its config holds the verification secret. */
export async function findProviderRow(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	provider: string,
): Promise<ProviderRow | null> {
	const row = await db
		.selectFrom("payment_providers")
		.select(["id", "site_id", "config"])
		.where("site_id", "=", siteId)
		.where("provider", "=", provider)
		.where("enabled", "=", 1)
		.executeTakeFirst();
	return row ? { id: row.id, site_id: row.site_id, config: parseConfig(row.config) } : null;
}

/** Site that booked one of these sales, for deliveries (refunds) that do not name it. */
async function siteOfBookedSale(
	db: Kysely<KlikapaDatabase>,
	provider: string,
	saleIds: string[],
): Promise<string | null> {
	if (saleIds.length === 0) return null;
	const row = await db
		.selectFrom("events")
		.select("site_id")
		.where(
			"external_id",
			"in",
			saleIds.map((id) => saleExternalId(provider, id)),
		)
		.where("is_bot", "in", [0, 1])
		.executeTakeFirst();
	return row?.site_id ?? null;
}

interface BookedLeg {
	event: ServerEventResult;
	leg: PaymentLeg;
}

async function bookSale(
	db: Kysely<KlikapaDatabase>,
	site: { id: string; revenue_currency?: string },
	provider: string,
	leg: PaymentLeg,
	env: Env["Bindings"],
): Promise<ServerEventResult> {
	return recordServerEvent(
		db,
		site,
		{
			siteId: site.id,
			name: leg.recurring ? `subscription_${leg.method}` : `payment_${leg.method}`,
			revenue: leg.amount,
			currency: leg.currency,
			externalId: saleExternalId(provider, leg.saleId),
			source: provider,
			rail: provider,
			props: { ...leg.props, payment_method: leg.method, provider_txn_id: leg.saleId },
			occurredAt: leg.occurredAt,
			netRevenue: leg.netAmount ?? null,
			visitorId: leg.visitorId,
			sessionId: leg.sessionId,
			utmSource: leg.utmSource,
			utmMedium: leg.utmMedium,
			utmCampaign: leg.utmCampaign,
			test: leg.test,
			paymentMethod: leg.method,
			subscriptionId:
				typeof leg.props.subscription_id === "string" ? leg.props.subscription_id : null,
		},
		env,
	);
}

/**
 * Book a refund. A refund that carries its own id is one row keyed by it; a provider that
 * reports the running refunded total gets the difference booked, so a replay, a late older
 * event or a second partial refund each add exactly what is new.
 */
async function bookRefund(
	db: Kysely<KlikapaDatabase>,
	site: { id: string; revenue_currency?: string },
	provider: string,
	leg: PaymentLeg,
	env: Env["Bindings"],
): Promise<ServerEventResult> {
	const base = saleExternalId(provider, leg.saleId);
	const input = (externalId: string, revenue: number) => ({
		siteId: site.id,
		name: "refund",
		revenue,
		currency: leg.currency,
		externalId,
		source: provider,
		rail: provider,
		props: { ...leg.props, payment_method: leg.method, provider_txn_id: leg.saleId },
		occurredAt: leg.occurredAt,
		test: leg.test,
		paymentMethod: leg.method,
		visitorId: leg.visitorId,
		sessionId: leg.sessionId,
	});

	if (!leg.cumulative) {
		const key = leg.refundId ? `${base}~${keyPart(leg.refundId)}:refund` : `${base}:refund`;
		return recordServerEvent(db, site, input(key, -leg.amount), env);
	}

	const targetMinor = Math.round(leg.amount * MINOR_PER_MAJOR);
	for (let attempt = 0; attempt < REFUND_BOOKING_ATTEMPTS; attempt++) {
		// Naming is_bot opts out of the bot filter, which would hide an excluded (test) refund row.
		const booked = await db
			.selectFrom("events")
			.select(["revenue"])
			.where("site_id", "=", site.id)
			.where((eb) =>
				eb.or([
					eb("external_id", "=", `${base}:refund`),
					eb(sql<string>`external_id`, "like", `${escapeLike(base)}~%:refund`),
				]),
			)
			.where("is_bot", "in", [0, 1])
			.execute();
		const bookedMinor = booked.reduce(
			(sum, row) => sum + Math.round(-(row.revenue ?? 0) * MINOR_PER_MAJOR),
			0,
		);
		const deltaMinor = targetMinor - bookedMinor;
		if (deltaMinor <= 0) {
			const existing = await db
				.selectFrom("events")
				.select(["id", "visitor_id"])
				.where("site_id", "=", site.id)
				.where("external_id", "=", `${base}:refund`)
				.where("is_bot", "in", [0, 1])
				.executeTakeFirst();
			return {
				eventId: existing?.id ?? "",
				visitorId: existing?.visitor_id ?? "",
				duplicate: true,
			};
		}
		const key = booked.length === 0 ? `${base}:refund` : `${base}~${bookedMinor}:refund`;
		const result = await recordServerEvent(
			db,
			site,
			input(key, -(deltaMinor / MINOR_PER_MAJOR)),
			env,
		);
		if (!result.duplicate) return result;
	}
	return { eventId: "", visitorId: "", duplicate: true };
}

async function bookLeg(
	db: Kysely<KlikapaDatabase>,
	site: { id: string; revenue_currency?: string },
	provider: string,
	leg: PaymentLeg,
	env: Env["Bindings"],
): Promise<ServerEventResult> {
	return leg.kind === "sale"
		? bookSale(db, site, provider, leg, env)
		: bookRefund(db, site, provider, leg, env);
}

function validLeg(leg: PaymentLeg): string | null {
	if (!leg.saleId) return "missing transaction id";
	if (!Number.isFinite(leg.amount) || leg.amount <= 0) return "amount must be positive";
	if (!normalizeCurrency(leg.currency)) return "unusable currency";
	return null;
}

/**
 * One pipeline for every provider: locate the site's provider row, verify the delivery with
 * its secret, parse it into legs, book each leg idempotently. Any failure after verification
 * answers 5xx so the provider retries: nothing is claimed before the booking itself, and a
 * booking is keyed by the provider's transaction id, so a retry can only complete the work.
 */
export async function handlePaymentWebhook(c: Context<Env>, adapter: PaymentAdapter) {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(rawBody);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("not an object");
		body = parsed as Record<string, unknown>;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}
	const ctx: DeliveryContext = {
		db,
		rawBody,
		body,
		header: (name) => c.req.header(name) ?? "",
		query: (name) => c.req.query(name),
		url: new URL(c.req.url),
	};
	const provider = adapter.provider;

	let row: ProviderRow | null;
	if (adapter.findProvider) {
		row = await adapter.findProvider(ctx);
	} else {
		const siteId =
			adapter.siteId(body) ||
			c.req.query("site_id") ||
			(await siteOfBookedSale(db, provider, adapter.saleIds?.(body) ?? []));
		if (!siteId) return c.json({ error: "site_id required" }, 400);
		row = await findProviderRow(db, siteId, provider);
	}
	if (!row) return c.json({ error: `No ${provider} integration` }, 404);
	const siteId = row.site_id;

	const verdict = await adapter.verify(ctx, row.config);
	if (!verdict.ok) {
		await logRejectedDelivery(db, siteId, row.id, `${provider}_${verdict.label}`, verdict.reason);
		return c.json({ error: verdict.message }, verdict.status);
	}

	let parsed: Awaited<ReturnType<PaymentAdapter["parse"]>>;
	try {
		parsed = await adapter.parse(ctx, row.config);
	} catch (err) {
		if (err instanceof RetryableDeliveryError) {
			await logWebhookEvent(db, siteId, row.id, `${provider}_retry`, rawBody, "failed").catch(
				() => undefined,
			);
			return c.json(RETRY_BODY, 503);
		}
		console.error(`[webhook:${provider}] parse failed:`, err);
		return c.json(SERVER_ERROR_BODY, 500);
	}
	if ("error" in parsed) {
		await logWebhookEvent(db, siteId, row.id, `${provider}_unparseable`, rawBody, "failed");
		return c.json({ error: parsed.error }, parsed.status ?? 422);
	}
	if ("ignored" in parsed) {
		await logWebhookEvent(
			db,
			siteId,
			row.id,
			`${provider}_${parsed.ignored}`,
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "logged" });
	}
	for (const leg of parsed.legs) {
		const problem = validLeg(leg);
		if (problem) {
			await logWebhookEvent(db, siteId, row.id, `${provider}_unparseable`, rawBody, "failed");
			return c.json({ error: `Cannot book this payment: ${problem}` }, 422);
		}
	}

	try {
		const site = await db
			.selectFrom("sites")
			.select(["id", "revenue_currency"])
			.where("id", "=", siteId)
			.executeTakeFirst();
		if (!site) return c.json({ error: "Site not found" }, 404);

		const booked: BookedLeg[] = [];
		for (const leg of parsed.legs) {
			booked.push({ event: await bookLeg(db, site, provider, leg, c.env), leg });
		}
		for (const { event, leg } of booked) {
			if (leg.kind === "sale" && !event.duplicate && !event.adopted && !leg.test) {
				notifySaleEvent(c.env, pushCtx(c), { id: event.eventId, siteId });
			}
		}
		await logWebhookEvent(db, siteId, row.id, `${provider}_${parsed.label}`, rawBody, "processed");
		const first = booked[0];
		return c.json({
			success: true,
			action: first?.event.duplicate ? "duplicate" : "booked",
			duplicate: booked.every((b) => b.event.duplicate),
			event_id: first?.event.eventId,
			revenue: first ? (first.leg.kind === "refund" ? -first.leg.amount : first.leg.amount) : 0,
			currency: first?.leg.currency.toUpperCase(),
			method: first?.leg.method,
		});
	} catch (err) {
		console.error(`[webhook:${provider}] booking failed, provider will retry:`, err);
		await logWebhookEvent(
			db,
			siteId,
			row.id,
			`${provider}_${parsed.label}`,
			rawBody,
			"failed",
		).catch(() => undefined);
		return c.json(SERVER_ERROR_BODY, 500);
	}
}

/** Webhook sub-app of one provider: POST / books a delivery, GET /test lists recent activity of a site. */
export function paymentWebhookRoutes(adapter: PaymentAdapter) {
	const app = new Hono<Env>();
	app.post("/", (c) => handlePaymentWebhook(c, adapter));
	app.get("/test", async (c) => {
		const db = c.get("db");
		const siteId = c.req.query("siteId");
		if (!siteId) return c.json({ error: "siteId required" }, 400);
		const logs = await db
			.selectFrom("webhook_events")
			.select(["id", "event_type", "status", "created_at", "processed_at"])
			.where("site_id", "=", siteId)
			.where("event_type", "like", `${adapter.provider}_%`)
			.orderBy("created_at", "desc")
			.limit(10)
			.execute();
		return c.json({ success: true, data: logs });
	});
	return app;
}

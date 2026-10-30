import { describe, expect, it } from "bun:test";
import type { MigratedTestApp } from "../lib/test-harness";
import {
	booked,
	countedRevenue,
	failEventInsertsOnce,
	hmacHex,
	quiet,
	SITE,
	setupProvider,
} from "../lib/payments/webhook-test-kit";

const SECRET = "whsec_test";

async function deliver(t: MigratedTestApp, event: Record<string, unknown>, secret = SECRET) {
	const body = JSON.stringify({ livemode: true, created: 1_790_000_000, ...event });
	const ts = Math.floor(Date.now() / 1000);
	return t.call("POST", `/api/webhooks/stripe?site_id=${SITE}`, {
		body,
		headers: {
			"content-type": "application/json",
			"Stripe-Signature": `t=${ts},v1=${await hmacHex(secret, `${ts}.${body}`)}`,
		},
	});
}

const session = (over: Record<string, unknown> = {}) => ({
	type: "checkout.session.completed",
	data: {
		object: {
			id: "cs_1",
			payment_status: "paid",
			amount_total: 2500,
			currency: "usd",
			payment_intent: "pi_1",
			mode: "payment",
			metadata: { revklik_site_id: SITE, revklik_visitor_id: "v-buyer" },
			...over,
		},
	},
});

const invoice = (over: Record<string, unknown> = {}, type = "invoice.paid") => ({
	type,
	data: {
		object: {
			id: "in_1",
			amount_paid: 4900,
			currency: "usd",
			billing_reason: "subscription_cycle",
			subscription: "sub_1",
			metadata: {},
			...over,
		},
	},
});

const charge = (refunded: number, over: Record<string, unknown> = {}) => ({
	type: "charge.refunded",
	data: {
		object: {
			id: "ch_1",
			payment_intent: "pi_1",
			amount: 2500,
			amount_refunded: refunded,
			currency: "usd",
			metadata: {},
			...over,
		},
	},
});

describe("Stripe webhook", () => {
	it("books a paid checkout as one sale with the buyer's visitor id and an FX stamp", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		expect((await deliver(t, session())).status).toBe(200);
		const [row, ...rest] = booked(t);
		expect(rest).toHaveLength(0);
		expect(row).toMatchObject({
			external_id: "stripe:pi_1",
			revenue: 25,
			currency: "USD",
			rail: "stripe",
			visitor_id: "v-buyer",
			fx_rate: 1,
			fx_status: "live",
		});
	});

	it("does not count an unpaid checkout or a test-mode payment", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		await deliver(t, session({ payment_status: "unpaid" }));
		expect(booked(t)).toHaveLength(0);
		await deliver(t, { ...session({ id: "cs_t", payment_intent: "pi_t" }), livemode: false });
		expect(booked(t)).toHaveLength(1);
		expect(booked(t)[0]?.excluded_reason).toBe("test");
		expect(countedRevenue(t)).toBe(0);
	});

	it("books a renewal from invoice.paid at amount_paid, not zero", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		expect((await deliver(t, invoice({ metadata: { revklik_site_id: SITE } }))).status).toBe(200);
		expect(booked(t)).toMatchObject([
			{ external_id: "stripe:in_1", revenue: 49, event_type: "conversion" },
		]);
	});

	it("converts minor units by the currency's own exponent (JPY has none)", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		await deliver(t, session({ amount_total: 3000, currency: "jpy" }));
		expect(booked(t)[0]).toMatchObject({ revenue: 3000, currency: "JPY" });
	});

	it("books a subscription's first payment once although a session and an invoice announce it", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		await deliver(
			t,
			session({
				id: "cs_sub",
				mode: "subscription",
				invoice: "in_first",
				payment_intent: null,
				subscription: "sub_1",
				amount_total: 4900,
			}),
		);
		await deliver(
			t,
			invoice({
				id: "in_first",
				billing_reason: "subscription_create",
				metadata: { revklik_site_id: SITE },
			}),
		);
		expect(booked(t)).toHaveLength(1);
		expect(booked(t)[0]?.visitor_id).toBe("v-buyer");
	});

	it("books partial then full refunds as the difference, once each, and finds the site from the sale", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		await deliver(t, session());
		// No site metadata and no query: the refund's site is the site that booked pi_1.
		const refund = async (cents: number) => {
			const body = JSON.stringify({ livemode: true, ...charge(cents) });
			const ts = Math.floor(Date.now() / 1000);
			return t.call("POST", "/api/webhooks/stripe", {
				body,
				headers: { "Stripe-Signature": `t=${ts},v1=${await hmacHex(SECRET, `${ts}.${body}`)}` },
			});
		};
		expect((await refund(1000)).status).toBe(200);
		expect((await refund(1000)).status).toBe(200);
		expect((await refund(2500)).status).toBe(200);
		const rows = booked(t);
		expect(
			rows
				.filter((r) => r.revenue < 0)
				.map((r) => r.revenue)
				.sort((a, b) => a - b),
		).toEqual([-15, -10]);
		expect(countedRevenue(t)).toBe(0);
		expect(rows.find((r) => r.revenue < 0)?.visitor_id).toBe("v-buyer");
	});

	it("replays are idempotent", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		await deliver(t, session());
		const again = await deliver(t, session());
		expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
		expect(booked(t)).toHaveLength(1);
	});

	it("a refund that arrives before its sale still nets to zero once the sale lands", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		await deliver(t, charge(2500, { metadata: { revklik_site_id: SITE } }));
		await deliver(t, session());
		expect(booked(t)).toHaveLength(2);
		expect(countedRevenue(t)).toBe(0);
	});

	it("fails the delivery on a transient error so Stripe retries, and the retry books exactly once", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		const pending = failEventInsertsOnce(t);
		const first = await quiet(() => deliver(t, session()));
		expect(first.status).toBe(500);
		expect(pending()).toBe(0);
		expect(booked(t)).toHaveLength(0);
		expect((await deliver(t, session())).status).toBe(200);
		expect(booked(t)).toHaveLength(1);
	});

	it("rejects a delivery signed with another site's secret", async () => {
		const t = await setupProvider("stripe", { webhook_secret: SECRET });
		expect((await deliver(t, session(), "whsec_other")).status).toBe(401);
		expect(booked(t)).toHaveLength(0);
	});
});

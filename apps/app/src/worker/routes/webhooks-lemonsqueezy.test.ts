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

const SECRET = "ls-secret";

async function deliver(
	t: MigratedTestApp,
	eventName: string,
	data: Record<string, unknown>,
	meta: Record<string, unknown> = {},
	secret = SECRET,
) {
	const body = JSON.stringify({
		meta: {
			event_name: eventName,
			test_mode: false,
			custom_data: { revklik_site_id: SITE, revklik_visitor_id: "v-ls" },
			...meta,
		},
		data,
	});
	return t.call("POST", "/api/webhooks/lemonsqueezy", {
		body,
		headers: { "x-signature": await hmacHex(secret, body) },
	});
}

const order = (over: Record<string, unknown> = {}) => ({
	id: "101",
	attributes: { status: "paid", total: 2900, currency: "USD", ...over },
});
const invoiceData = (over: Record<string, unknown> = {}) => ({
	id: "555",
	attributes: {
		status: "paid",
		total: 2900,
		currency: "USD",
		billing_reason: "renewal",
		subscription_id: 9,
		...over,
	},
});

describe("LemonSqueezy webhook", () => {
	it("books a paid order, and ignores a pending one", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		await deliver(t, "order_created", order({ status: "pending" }));
		expect(booked(t)).toHaveLength(0);
		expect((await deliver(t, "order_created", order())).status).toBe(200);
		expect(booked(t)).toMatchObject([
			{
				external_id: "lemonsqueezy:order-101",
				revenue: 29,
				rail: "lemonsqueezy",
				visitor_id: "v-ls",
			},
		]);
	});

	it("counts a subscription's first payment once, then books each renewal", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		await deliver(t, "order_created", order());
		await deliver(t, "subscription_created", {
			id: "9",
			attributes: { status: "active", currency: "USD" },
		});
		await deliver(
			t,
			"subscription_payment_success",
			invoiceData({ id: "554", billing_reason: "initial" }),
		);
		expect(booked(t)).toHaveLength(1);
		await deliver(t, "subscription_payment_success", invoiceData());
		expect(booked(t).map((r) => r.external_id)).toEqual([
			"lemonsqueezy:invoice-555",
			"lemonsqueezy:order-101",
		]);
		expect(countedRevenue(t)).toBe(58);
	});

	it("books test-mode orders as excluded", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		await deliver(t, "order_created", order(), { test_mode: true });
		expect(booked(t)[0]?.excluded_reason).toBe("test");
		expect(countedRevenue(t)).toBe(0);
	});

	it("books refunds by the running refunded total, order and renewal alike", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		await deliver(t, "order_created", order());
		await deliver(t, "subscription_payment_success", invoiceData());
		await deliver(t, "order_refunded", order({ status: "partial_refund", refunded_amount: 1000 }));
		await deliver(t, "order_refunded", order({ status: "partial_refund", refunded_amount: 1000 }));
		await deliver(t, "order_refunded", order({ status: "refunded", refunded_amount: 2900 }));
		await deliver(t, "subscription_payment_refunded", invoiceData({ refunded_amount: 2900 }));
		const refunds = booked(t)
			.filter((r) => r.revenue < 0)
			.map((r) => r.revenue)
			.sort((a, b) => a - b);
		expect(refunds).toEqual([-29, -19, -10]);
		expect(countedRevenue(t)).toBe(0);
	});

	it("is idempotent on replay and tolerates a refund arriving before its sale", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		await deliver(t, "order_refunded", order({ status: "refunded", refunded_amount: 2900 }));
		await deliver(t, "order_created", order({ status: "refunded" }));
		await deliver(t, "order_created", order({ status: "refunded" }));
		expect(booked(t)).toHaveLength(2);
		expect(countedRevenue(t)).toBe(0);
	});

	it("a transient failure is not lost: the delivery fails, the provider's retry books it", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		failEventInsertsOnce(t);
		expect((await quiet(() => deliver(t, "order_created", order()))).status).toBe(500);
		const retry = await deliver(t, "order_created", order());
		expect(retry.status).toBe(200);
		expect(((await retry.json()) as { duplicate: boolean }).duplicate).toBe(false);
		expect(booked(t)).toHaveLength(1);
	});

	it("rejects a bad signature", async () => {
		const t = await setupProvider("lemonsqueezy", { webhook_secret: SECRET });
		expect((await deliver(t, "order_created", order(), {}, "nope")).status).toBe(401);
		expect(booked(t)).toHaveLength(0);
	});
});

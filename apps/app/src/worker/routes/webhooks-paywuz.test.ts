import { afterEach, describe, expect, it } from "bun:test";
import type { MigratedTestApp } from "../lib/test-harness";
import {
	booked,
	countedRevenue,
	failEventInsertsOnce,
	quiet,
	SITE,
	setupProvider,
} from "../lib/payments/webhook-test-kit";

const TOKEN = "tok-paywuz";
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function deliver(t: MigratedTestApp, body: Record<string, unknown>, token = TOKEN) {
	return t.call("POST", "/api/webhooks/paywuz", { body, headers: { "x-webhook-token": token } });
}

const order = (over: Record<string, unknown> = {}) => ({
	orderId: "PW-1",
	status: "success",
	amount: 75_000,
	paymentMethod: "QRIS",
	paidAt: "2026-10-30T08:00:00.000Z",
	metadata: {
		revklik_site_id: SITE,
		revklik_session_id: "ses-pw",
		revklik_utm_source: "newsletter",
	},
	...over,
});

describe("Paywuz webhook", () => {
	it("books a paid order with the utm source passed through the metadata", async () => {
		const t = await setupProvider("paywuz", { webhook_secret: TOKEN });
		expect((await deliver(t, order())).status).toBe(200);
		expect(booked(t)).toMatchObject([
			{
				external_id: "paywuz:PW-1",
				revenue: 75_000,
				currency: "IDR",
				rail: "paywuz",
				payment_method: "qris",
			},
		]);
		const row = t.db
			.query("SELECT utm_source FROM events WHERE external_id = 'paywuz:PW-1'")
			.get() as { utm_source: string };
		expect(row.utm_source).toBe("newsletter");
	});

	it("does not count an absent or unpaid status", async () => {
		const t = await setupProvider("paywuz", { webhook_secret: TOKEN });
		await deliver(t, order({ status: undefined }));
		await deliver(t, order({ orderId: "PW-2", status: "pending" }));
		expect(booked(t)).toHaveLength(0);
	});

	it("requires the webhook secret and checks it", async () => {
		const t = await setupProvider("paywuz", { api_key: "k" });
		expect((await deliver(t, order())).status).toBe(401);
		const t2 = await setupProvider("paywuz", { webhook_secret: TOKEN });
		expect((await deliver(t2, order(), "wrong")).status).toBe(401);
		expect(booked(t)).toHaveLength(0);
		expect(booked(t2)).toHaveLength(0);
	});

	it("trusts the API over the body when a key is saved, and retries when the API is down", async () => {
		const t = await setupProvider("paywuz", { webhook_secret: TOKEN, api_key: "k" });
		globalThis.fetch = (async () => new Response("down", { status: 502 })) as never;
		expect((await deliver(t, order())).status).toBe(503);
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: { orderId: "PW-1", status: "paid", amount: 70_000 } }), {
				status: 200,
			})) as never;
		expect((await deliver(t, order({ amount: 1 }))).status).toBe(200);
		expect(booked(t)[0]?.revenue).toBe(70_000);
		globalThis.fetch = (async () => new Response("nope", { status: 404 })) as never;
		expect((await deliver(t, order({ orderId: "ghost" }))).status).toBe(401);
		expect(booked(t)).toHaveLength(1);
	});

	it("books a refunded order negative once, replays are no-ops, and a refund before its sale nets out", async () => {
		const t = await setupProvider("paywuz", { webhook_secret: TOKEN });
		await deliver(t, order({ status: "refunded" }));
		await deliver(t, order());
		await deliver(t, order());
		await deliver(t, order({ status: "refunded" }));
		expect(booked(t)).toHaveLength(2);
		expect(countedRevenue(t)).toBe(0);
	});

	it("a transient DB failure answers 5xx and the retry books once", async () => {
		const t = await setupProvider("paywuz", { webhook_secret: TOKEN });
		failEventInsertsOnce(t);
		expect((await quiet(() => deliver(t, order()))).status).toBe(500);
		expect((await deliver(t, order())).status).toBe(200);
		expect(booked(t)).toHaveLength(1);
	});
});

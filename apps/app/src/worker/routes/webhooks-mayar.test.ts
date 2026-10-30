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

const TOKEN = "tok-mayar";
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function deliver(t: MigratedTestApp, body: Record<string, unknown>, token = TOKEN) {
	return t.call("POST", "/api/webhooks/mayar", { body, headers: { "x-webhook-token": token } });
}

const payment = (over: Record<string, unknown> = {}) => ({
	data: {
		id: "txn-1",
		status: "SUCCESS",
		amount: 120_000,
		paymentMethod: "QRIS",
		createdAt: "2026-10-30T09:00:00.000Z",
		metadata: { revklik_site_id: SITE, revklik_visitor_id: "v-myr" },
		...over,
	},
});

const stubApi = (pages: Array<unknown[] | number>) => {
	const calls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		calls.push(url);
		const page = Number(new URL(url).searchParams.get("page"));
		const entry = pages[page - 1];
		if (typeof entry === "number") return new Response("down", { status: entry });
		return new Response(JSON.stringify({ data: entry ?? [] }), { status: 200 });
	}) as never;
	return calls;
};

describe("Mayar webhook", () => {
	it("books a settled payment attributed to the named visitor", async () => {
		const t = await setupProvider("mayar", { webhook_secret: TOKEN });
		expect((await deliver(t, payment())).status).toBe(200);
		expect(booked(t)).toMatchObject([
			{
				external_id: "mayar:txn-1",
				revenue: 120_000,
				currency: "IDR",
				visitor_id: "v-myr",
				payment_method: "qris",
			},
		]);
	});

	it("never counts a payment whose status is missing or not paid", async () => {
		const t = await setupProvider("mayar", { webhook_secret: TOKEN });
		await deliver(t, payment({ status: undefined }));
		await deliver(t, payment({ id: "txn-2", status: "PENDING" }));
		expect(booked(t)).toHaveLength(0);
		await deliver(t, { event: "payment.received", ...payment({ id: "txn-3", status: undefined }) });
		expect(booked(t)).toHaveLength(1);
	});

	it("requires the webhook secret, even when an API key is saved", async () => {
		const t = await setupProvider("mayar", { api_key: "k" });
		expect((await deliver(t, payment())).status).toBe(401);
		const t2 = await setupProvider("mayar", { webhook_secret: TOKEN });
		expect((await deliver(t2, payment(), "wrong")).status).toBe(401);
		expect(booked(t)).toHaveLength(0);
		expect(booked(t2)).toHaveLength(0);
	});

	it("with an API key, books what Mayar reports (page 2 included) and rejects an unlisted transaction", async () => {
		const t = await setupProvider("mayar", {
			webhook_secret: TOKEN,
			api_key: "k",
			api_version: "v2",
		});
		const full = Array.from({ length: 100 }, (_, i) => ({
			id: `other-${i}`,
			status: "paid",
			credit: 1,
		}));
		stubApi([full, [{ id: "txn-1", status: "settled", credit: 120_000, paymentMethod: "qris" }]]);
		expect((await deliver(t, payment({ amount: 1 }))).status).toBe(200);
		expect(booked(t)[0]?.revenue).toBe(120_000);
		stubApi([[]]);
		expect((await deliver(t, payment({ id: "ghost" }))).status).toBe(401);
		expect(booked(t)).toHaveLength(1);
	});

	it("answers 503 when Mayar's API is down so the delivery is retried, and the retry books", async () => {
		const t = await setupProvider("mayar", { webhook_secret: TOKEN, api_key: "k" });
		stubApi([503]);
		expect((await deliver(t, payment())).status).toBe(503);
		expect(booked(t)).toHaveLength(0);
		stubApi([[{ id: "txn-1", status: "paid", credit: 120_000 }]]);
		expect((await deliver(t, payment())).status).toBe(200);
		expect(booked(t)).toHaveLength(1);
	});

	it("books a renewal when the API names a subscription, and a refund as a negative row", async () => {
		const t = await setupProvider("mayar", { webhook_secret: TOKEN });
		await deliver(t, payment({ subscriptionId: "sub-1" }));
		const sub = t.db
			.query("SELECT subscription_id, name FROM events WHERE external_id = 'mayar:txn-1'")
			.get() as { subscription_id: string; name: string };
		expect(sub).toEqual({ subscription_id: "sub-1", name: "subscription_qris" });
		await deliver(t, payment({ status: "refunded" }));
		await deliver(t, payment({ status: "refunded" }));
		expect(booked(t)).toHaveLength(2);
		expect(countedRevenue(t)).toBe(0);
	});

	it("a refund before its sale, replays, and a transient DB failure", async () => {
		const t = await setupProvider("mayar", { webhook_secret: TOKEN });
		await deliver(t, payment({ status: "refunded" }));
		failEventInsertsOnce(t);
		expect((await quiet(() => deliver(t, payment()))).status).toBe(500);
		expect((await deliver(t, payment())).status).toBe(200);
		expect((await deliver(t, payment())).status).toBe(200);
		expect(booked(t)).toHaveLength(2);
		expect(countedRevenue(t)).toBe(0);
	});
});

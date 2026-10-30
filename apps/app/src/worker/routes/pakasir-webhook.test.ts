import { afterEach, describe, expect, it } from "bun:test";
import { createMigratedTestApp } from "../lib/test-harness";

/**
 * Pakasir is RevKlik's own QRIS billing: one payment per order, no renewal or refund event.
 * What can go wrong is a transient failure after the order is claimed.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("Pakasir webhook", () => {
	it("hands the order back when granting the period fails, so Pakasir's retry still activates it", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		const token = await t.seedUser({ id: "u-pk", plan: "micro" });
		const checkout = await t.call("POST", "/api/billing/checkout/pakasir", {
			token,
			body: { plan: "starter" },
		});
		const orderId = ((await checkout.json()) as { data: { order_id: string } }).data.order_id;
		const payload = { amount: 64_000, order_id: orderId, project: "revklik", status: "completed" };
		globalThis.fetch = (async () =>
			Response.json({ transaction: { ...payload } })) as unknown as typeof fetch;

		const real = t.env.DB as D1Database;
		let failing = true;
		t.env.DB = {
			...real,
			prepare(sql: string) {
				if (failing && /insert into "subscriptions"/i.test(sql))
					throw new Error("D1_ERROR: transient");
				return real.prepare(sql);
			},
		} as unknown as D1Database;
		const original = console.error;
		console.error = () => undefined;
		const first = await t.call("POST", "/api/webhooks/pakasir", { body: payload }).finally(() => {
			console.error = original;
		});
		expect(first.status).toBeGreaterThanOrEqual(500);
		const status = () =>
			(
				t.db.query("SELECT status FROM pakasir_orders WHERE order_id = ?").get(orderId) as {
					status: string;
				}
			).status;
		expect(status()).toBe("pending");

		failing = false;
		const retry = await t.call("POST", "/api/webhooks/pakasir", { body: payload });
		expect(((await retry.json()) as { activated: boolean }).activated).toBe(true);
		expect(status()).toBe("completed");
		const replay = await t.call("POST", "/api/webhooks/pakasir", { body: payload });
		expect(((await replay.json()) as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);
	});
});

import { afterEach, describe, expect, it } from "bun:test";
import { createMigratedTestApp } from "../lib/test-harness";
import { signStandardWebhook } from "../lib/standard-webhooks";

const POLAR_SECRET = "polar_whs_test_secret";
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
		handler(String(input instanceof Request ? input.url : input), init)) as typeof fetch;
}

async function polarDelivery(body: unknown, id = crypto.randomUUID(), tsOffset = 0) {
	const raw = JSON.stringify(body);
	const ts = String(Math.floor(Date.now() / 1000) + tsOffset);
	return {
		body: raw,
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": ts,
			"webhook-signature": await signStandardWebhook(raw, id, ts, POLAR_SECRET),
		},
	};
}

function subRow(t: Awaited<ReturnType<typeof createMigratedTestApp>>, userId: string) {
	return t.db
		.query(
			"SELECT plan, status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = ?",
		)
		.get(userId) as {
		plan: string;
		status: string;
		current_period_end: string;
		cancel_at_period_end: number;
	};
}

describe("QRIS checkout (DEV-29)", () => {
	it("records a pending order without demoting an active subscription", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		const token = await t.seedUser({ id: "u-q1", plan: "starter", withSite: "s-q1" });

		const res = await t.call("POST", "/api/billing/checkout/pakasir", {
			token,
			body: { plan: "growth" },
			headers: { "CF-IPCountry": "ID" },
		});
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as { data: { order_id: string; url: string } };

		expect(subRow(t, "u-q1").status).toBe("active");
		expect(subRow(t, "u-q1").plan).toBe("starter");

		const subRes = await t.call("GET", "/api/billing/subscription", { token });
		const sub = (await subRes.json()) as {
			data: { pending_order: { order_id: string; plan: string; checkout_url: string } | null };
		};
		expect(sub.data.pending_order?.order_id).toBe(data.order_id);
		expect(sub.data.pending_order?.plan).toBe("growth");
		expect(sub.data.pending_order?.checkout_url).toBe(data.url);
	});

	it("activates once; a replayed completed webhook cannot extend the period", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		const token = await t.seedUser({ id: "u-q2", withSite: "s-q2" });
		const res = await t.call("POST", "/api/billing/checkout/pakasir", {
			token,
			body: { plan: "micro" },
		});
		const { data } = (await res.json()) as { data: { order_id: string } };
		mockFetch(() =>
			Response.json({
				transaction: {
					amount: 16_000,
					order_id: data.order_id,
					project: "revklik",
					status: "completed",
				},
			}),
		);
		const payload = {
			amount: 16_000,
			order_id: data.order_id,
			project: "revklik",
			status: "completed",
		};

		const first = await t.call("POST", "/api/webhooks/pakasir", { body: payload });
		expect(((await first.json()) as { activated: boolean }).activated).toBe(true);
		const endAfterFirst = subRow(t, "u-q2").current_period_end;

		const replay = await t.call("POST", "/api/webhooks/pakasir", { body: payload });
		const replayBody = (await replay.json()) as { activated: boolean; alreadyProcessed: boolean };
		expect(replayBody.activated).toBe(false);
		expect(replayBody.alreadyProcessed).toBe(true);
		expect(subRow(t, "u-q2").current_period_end).toBe(endAfterFirst);

		const verify = await t.call("POST", "/api/billing/pakasir/verify", { token, body: {} });
		expect(verify.status).toBe(200);
		expect(subRow(t, "u-q2").current_period_end).toBe(endAfterFirst);
	});

	it("refuses webhooks when PAKASIR_API_KEY is unset", async () => {
		const t = await createMigratedTestApp();
		const res = await t.call("POST", "/api/webhooks/pakasir", {
			body: { amount: 16_000, order_id: "RVK-x-y", project: "revklik", status: "completed" },
		});
		expect(res.status).toBe(503);
	});

	it("refuses unknown orders", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		const res = await t.call("POST", "/api/webhooks/pakasir", {
			body: { amount: 16_000, order_id: "RVK-nope-1", project: "revklik", status: "completed" },
		});
		expect(res.status).toBe(404);
	});
});

describe("Polar billing webhook (DEV-29)", () => {
	it("fails closed without POLAR_WEBHOOK_SECRET", async () => {
		const t = await createMigratedTestApp();
		const res = await t.call("POST", "/api/billing/webhook", { body: { type: "x" } });
		expect(res.status).toBe(503);
	});

	it("rejects missing headers, bad signatures and stale timestamps", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: POLAR_SECRET });
		const bare = await t.call("POST", "/api/billing/webhook", { body: { type: "x" } });
		expect(bare.status).toBe(401);

		const stale = await polarDelivery({ type: "subscription.active" }, undefined, -3600);
		const staleRes = await t.call("POST", "/api/billing/webhook", stale);
		expect(((await staleRes.json()) as { error: string }).error).toContain("Stale");

		const good = await polarDelivery({ type: "subscription.active" });
		const forged = await t.call("POST", "/api/billing/webhook", {
			body: good.body.replace("active", "updated"),
			headers: good.headers,
		});
		expect(forged.status).toBe(401);
	});

	it("ignores checkout.created instead of upserting the checkout as a subscription", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: POLAR_SECRET });
		await t.seedUser({ id: "u-p1", plan: "micro", status: "trialing" });
		const delivery = await polarDelivery({
			type: "checkout.created",
			data: { id: "chk_1", status: "open", metadata: { user_id: "u-p1", plan: "growth" } },
		});
		const res = await t.call("POST", "/api/billing/webhook", delivery);
		expect(res.status).toBe(200);
		expect(subRow(t, "u-p1")).toMatchObject({ plan: "micro", status: "trialing" });
	});

	it("subscription.canceled keeps access to period end; revoked ends it; replays are no-ops", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: POLAR_SECRET });
		await t.seedUser({ id: "u-p2", plan: "growth" });
		const periodEnd = new Date(Date.now() + 10 * 86_400_000).toISOString();

		const cancel = await polarDelivery({
			type: "subscription.canceled",
			data: { id: "sub_1", current_period_end: periodEnd, metadata: { user_id: "u-p2" } },
		});
		expect((await t.call("POST", "/api/billing/webhook", cancel)).status).toBe(200);
		expect(subRow(t, "u-p2")).toMatchObject({
			status: "active",
			cancel_at_period_end: 1,
			current_period_end: periodEnd,
		});

		const replay = await t.call("POST", "/api/billing/webhook", cancel);
		expect(((await replay.json()) as { duplicate?: boolean }).duplicate).toBe(true);

		const revoke = await polarDelivery({
			type: "subscription.revoked",
			data: { id: "sub_1", metadata: { user_id: "u-p2" } },
		});
		await t.call("POST", "/api/billing/webhook", revoke);
		const row = subRow(t, "u-p2");
		expect(row.status).toBe("canceled");
		expect(new Date(row.current_period_end).getTime()).toBeLessThanOrEqual(Date.now());
	});
});

describe("billing routes (DEV-29)", () => {
	it("card checkout without Polar config is an error, not a dead link", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-c1", plan: "micro" });
		const res = await t.call("POST", "/api/billing/checkout", { token, body: { plan: "growth" } });
		expect(res.status).toBe(503);
		const body = (await res.json()) as { success: boolean; data?: unknown };
		expect(body.success).toBe(false);
		expect(body.data).toBeUndefined();
	});

	it("cancel does not mark the subscription when Polar rejects the call", async () => {
		const t = await createMigratedTestApp({ POLAR_ACCESS_TOKEN: "tok" });
		const token = await t.seedUser({ id: "u-c2", plan: "starter" });
		t.db.exec("UPDATE subscriptions SET polar_subscription_id = 'sub_9' WHERE user_id = 'u-c2'");
		mockFetch(() => new Response("nope", { status: 500 }));
		const res = await t.call("POST", "/api/billing/cancel", { token });
		expect(res.status).toBe(502);
		expect(subRow(t, "u-c2").cancel_at_period_end).toBe(0);

		mockFetch(() => Response.json({ id: "sub_9" }));
		const ok = await t.call("POST", "/api/billing/cancel", { token });
		expect(ok.status).toBe(200);
		expect(subRow(t, "u-c2").cancel_at_period_end).toBe(1);
	});
});

describe("LemonSqueezy webhook (DEV-29)", () => {
	it("requires a signature and dedupes by exact order id", async () => {
		const secret = "ls-secret";
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-ls", plan: "growth", withSite: "s-ls" });
		t.db
			.prepare(
				"INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled, created_at) VALUES ('i-ls','s-ls','u-ls','lemonsqueezy','LS',?,1,datetime('now'))",
			)
			.run(JSON.stringify({ webhook_secret: secret }));
		const payload = JSON.stringify({
			meta: { event_name: "order_created", custom_data: { revklik_site_id: "s-ls" } },
			data: { id: "12", attributes: { total: 1000, currency: "usd" } },
		});

		const unsigned = await t.call("POST", "/api/webhooks/lemonsqueezy", { body: payload });
		expect(unsigned.status).toBe(401);

		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = Array.from(
			new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))),
			(b) => b.toString(16).padStart(2, "0"),
		).join("");
		const headers = { "x-signature": sig, "content-type": "application/json" };
		expect(
			(await t.call("POST", "/api/webhooks/lemonsqueezy", { body: payload, headers })).status,
		).toBe(200);
		const dup = await t.call("POST", "/api/webhooks/lemonsqueezy", { body: payload, headers });
		expect(((await dup.json()) as { duplicate?: boolean }).duplicate).toBe(true);

		// Order "1" must not be swallowed by a LIKE match on order "12".
		const other = payload.replace('"id":"12"', '"id":"1"');
		const otherSig = Array.from(
			new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(other))),
			(b) => b.toString(16).padStart(2, "0"),
		).join("");
		const res = await t.call("POST", "/api/webhooks/lemonsqueezy", {
			body: other,
			headers: { ...headers, "x-signature": otherSig },
		});
		expect(((await res.json()) as { duplicate?: boolean }).duplicate).toBeUndefined();
	});
});

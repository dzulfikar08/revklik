import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";

/**
 * Stripe and Lemon Squeezy read their per-site secret from payment_providers, the
 * table the settings UI writes. Each site's endpoint accepts only its own secret.
 */

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function setup(provider: "stripe" | "lemonsqueezy") {
	const t = await createMigratedTestApp();
	await t.seedUser({ id: "u-a", withSite: "s-a" });
	await t.seedUser({ id: "u-b", withSite: "s-b" });
	for (const [site, secret] of [
		["s-a", "secret-a"],
		["s-b", "secret-b"],
	] as const) {
		t.db
			.prepare(
				"INSERT INTO payment_providers (id, site_id, provider, config, enabled) VALUES (?,?,?,?,1)",
			)
			.run(`pp-${site}`, site, provider, JSON.stringify({ webhook_secret: secret }));
	}
	return t;
}

const revenueRows = (t: MigratedTestApp, site: string) =>
	(
		t.db.query("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND revenue > 0").get(site) as {
			n: number;
		}
	).n;

async function postStripe(t: MigratedTestApp, site: string, secret: string, id: string) {
	const body = JSON.stringify({
		type: "checkout.session.completed",
		data: { object: { id, amount_total: 2500, currency: "usd", metadata: {} } },
	});
	const ts = Math.floor(Date.now() / 1000);
	return t.call("POST", `/api/webhooks/stripe?site_id=${site}`, {
		body,
		headers: {
			"content-type": "application/json",
			"Stripe-Signature": `t=${ts},v1=${await hmacHex(secret, `${ts}.${body}`)}`,
		},
	});
}

async function postLemon(t: MigratedTestApp, site: string, secret: string, id: string) {
	const body = JSON.stringify({
		meta: { event_name: "order_created" },
		data: { id, attributes: { total: 1000, currency: "usd" } },
	});
	return t.call("POST", `/api/webhooks/lemonsqueezy?site_id=${site}`, {
		body,
		headers: { "content-type": "application/json", "x-signature": await hmacHex(secret, body) },
	});
}

describe("Stripe webhook per-site secret (payment_providers)", () => {
	it("books with the site's own secret and rejects every other one", async () => {
		const t = await setup("stripe");
		expect((await postStripe(t, "s-a", "secret-a", "cs_a")).status).toBe(200);
		expect(revenueRows(t, "s-a")).toBe(1);

		expect((await postStripe(t, "s-b", "secret-a", "cs_cross")).status).toBe(401);
		expect((await postStripe(t, "s-a", "wrong", "cs_wrong")).status).toBe(401);
		expect(revenueRows(t, "s-b")).toBe(0);

		expect((await postStripe(t, "s-b", "secret-b", "cs_b")).status).toBe(200);
		expect(revenueRows(t, "s-b")).toBe(1);
	});

	it("answers 404 for a site with no Stripe row or a disabled one", async () => {
		const t = await setup("stripe");
		await t.seedUser({ id: "u-c", withSite: "s-c" });
		expect((await postStripe(t, "s-c", "secret-a", "cs_c")).status).toBe(404);
		t.db.exec("UPDATE payment_providers SET enabled = 0 WHERE site_id = 's-a'");
		expect((await postStripe(t, "s-a", "secret-a", "cs_off")).status).toBe(404);
		expect(revenueRows(t, "s-a")).toBe(0);
	});

	it("ignores a row for another provider", async () => {
		const t = await setup("stripe");
		t.db.exec("UPDATE payment_providers SET provider = 'xendit' WHERE site_id = 's-a'");
		expect((await postStripe(t, "s-a", "secret-a", "cs_x")).status).toBe(404);
	});
});

describe("Lemon Squeezy webhook per-site secret (payment_providers)", () => {
	it("books with the site's own secret and rejects every other one", async () => {
		const t = await setup("lemonsqueezy");
		expect((await postLemon(t, "s-a", "secret-a", "ls-1")).status).toBe(200);
		expect(revenueRows(t, "s-a")).toBe(1);

		expect((await postLemon(t, "s-b", "secret-a", "ls-cross")).status).toBe(401);
		expect((await postLemon(t, "s-a", "wrong", "ls-wrong")).status).toBe(401);
		expect(revenueRows(t, "s-b")).toBe(0);

		expect((await postLemon(t, "s-b", "secret-b", "ls-2")).status).toBe(200);
		expect(revenueRows(t, "s-b")).toBe(1);
	});

	it("answers 404 for a site with no Lemon Squeezy row or a disabled one", async () => {
		const t = await setup("lemonsqueezy");
		await t.seedUser({ id: "u-c", withSite: "s-c" });
		expect((await postLemon(t, "s-c", "secret-a", "ls-c")).status).toBe(404);
		t.db.exec("UPDATE payment_providers SET enabled = 0 WHERE site_id = 's-a'");
		expect((await postLemon(t, "s-a", "secret-a", "ls-off")).status).toBe(404);
	});
});

describe("rejected deliveries are logged without the body, once a minute", () => {
	const rejected = (t: MigratedTestApp, type: string) =>
		t.db.query("SELECT payload, status FROM webhook_events WHERE event_type = ?").all(type) as {
			payload: string;
			status: string;
		}[];

	it("Stripe", async () => {
		const t = await setup("stripe");
		for (const id of ["cs_1", "cs_2", "cs_3"]) await postStripe(t, "s-a", "wrong", id);
		const rows = rejected(t, "stripe_invalid_sig");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("failed");
		expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ reason: "invalid_signature" });
		expect(rows[0]?.payload).not.toContain("cs_1");
	});

	it("Lemon Squeezy", async () => {
		const t = await setup("lemonsqueezy");
		for (const id of ["ls-1", "ls-2", "ls-3"]) await postLemon(t, "s-a", "wrong", id);
		const rows = rejected(t, "lemonsqueezy_invalid_sig");
		expect(rows).toHaveLength(1);
		expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ reason: "invalid_signature" });
		expect(rows[0]?.payload).not.toContain("ls-1");
	});

	it("a provider row with no secret logs the reason only", async () => {
		const t = await setup("stripe");
		t.db.exec("UPDATE payment_providers SET config = '{}' WHERE site_id = 's-a'");
		expect((await postStripe(t, "s-a", "secret-a", "cs_nosecret")).status).toBe(401);
		const rows = rejected(t, "stripe_no_secret");
		expect(rows).toHaveLength(1);
		expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ reason: "no_secret" });
	});
});

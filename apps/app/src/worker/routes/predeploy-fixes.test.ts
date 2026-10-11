import { describe, expect, it } from "bun:test";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { createMigratedTestApp } from "../lib/test-harness";

const DAY = 86_400_000;

async function memberOfGrowthSite() {
	const t = await createMigratedTestApp();
	const owner = await t.seedUser({ id: "u-gowner", plan: "growth", withSite: "s-growth" });
	const member = await t.seedUser({ id: "u-member", plan: "micro", withSite: "s-own" });
	t.db.exec(
		"INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES ('tm', 's-growth', 'u-member', 'admin', 'u-gowner', '2026-01-01')",
	);
	return { t, member, owner };
}

describe("R2: plan gate reads the body whatever the content-type", () => {
	it("a text/plain body naming another site is rejected", async () => {
		const { t, member, owner } = await memberOfGrowthSite();
		const res = await t.call("POST", "/api/integrations?site_id=s-growth", {
			token: member,
			body: JSON.stringify({ site_id: "s-own", type: "kit", name: "Kit", config: {} }),
			headers: { "content-type": "text/plain" },
		});
		expect(res.status).toBe(400);
		expect(t.db.query("SELECT COUNT(*) AS n FROM integrations").get()).toEqual({ n: 0 });

		// Consistent ids still reach the handler, which reads the cached body.
		const ok = await t.call("POST", "/api/integrations?site_id=s-growth", {
			token: owner,
			body: JSON.stringify({ site_id: "s-growth", type: "kit", name: "Kit", config: {} }),
			headers: { "content-type": "text/plain" },
		});
		expect(ok.status).toBe(201);
	});

	it("PATCH /integrations/:id is gated on the integration's own site", async () => {
		const { t, member } = await memberOfGrowthSite();
		t.db.exec(
			"INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled) VALUES ('i-own', 's-own', 'u-member', 'kit', 'Kit', '{}', 1)",
		);
		const borrowed = await t.call("PATCH", "/api/integrations/i-own?site_id=s-growth", {
			token: member,
			body: { name: "renamed" },
		});
		expect(borrowed.status).toBe(400);
		const own = await t.call("PATCH", "/api/integrations/i-own", {
			token: member,
			body: { name: "renamed" },
		});
		expect(own.status).toBe(403);
		expect(((await own.json()) as { current_plan: string }).current_plan).toBe("micro");
	});
});

describe("R3: QRIS user upgrading through Polar", () => {
	it("subscription.created is applied even though the QRIS period ends later", async () => {
		const secret = "polar_whs_r3";
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: secret });
		await t.seedUser({ id: "u-upgrade", plan: "starter" });
		const qrisEnd = new Date(Date.now() + 25 * DAY).toISOString();
		t.db
			.prepare(
				"UPDATE subscriptions SET current_period_end = ?, pakasir_paid_until = ?, pakasir_order_id = 'RVK-1' WHERE user_id = 'u-upgrade'",
			)
			.run(qrisEnd, qrisEnd);
		const body = JSON.stringify({
			type: "subscription.created",
			data: {
				id: "sub_up",
				status: "active",
				current_period_end: new Date(Date.now() + 10 * DAY).toISOString(),
				metadata: { user_id: "u-upgrade", plan: "growth" },
			},
		});
		const ts = String(Math.floor(Date.now() / 1000));
		await t.call("POST", "/api/billing/webhook", {
			body,
			headers: {
				"content-type": "application/json",
				"webhook-id": "w-up",
				"webhook-timestamp": ts,
				"webhook-signature": await signStandardWebhook(body, "w-up", ts, secret),
			},
		});
		const row = t.db
			.query(
				"SELECT plan, polar_subscription_id, current_period_end FROM subscriptions WHERE user_id = 'u-upgrade'",
			)
			.get();
		expect(row).toEqual({
			plan: "growth",
			polar_subscription_id: "sub_up",
			current_period_end: qrisEnd,
		});
	});
});

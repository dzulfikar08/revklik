import { describe, expect, it } from "bun:test";
import { createMigratedTestApp } from "./test-harness";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

describe("lapsed accounts (DEV-34)", () => {
	it("analytics reads answer 402 subscription_inactive; billing, sites and auth stay open", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({
			id: "u-lapsed",
			plan: "growth",
			status: "trialing",
			periodEnd: ago(2),
			withSite: "s-lapsed",
		});
		const dash = await t.call("GET", "/api/analytics/dashboard?site_id=s-lapsed", { token });
		expect(dash.status).toBe(402);
		expect((await dash.json()) as Record<string, unknown>).toEqual({
			success: false,
			error: "subscription_inactive",
			// period ended 2 days ago: 12 of the 14 grace days remain
			grace_days_remaining: 12,
		});

		const expired = await t.seedUser({
			id: "u-past-grace",
			plan: "starter",
			periodEnd: ago(30),
			withSite: "s-past-grace",
		});
		const gone = await t.call("GET", "/api/analytics/dashboard?site_id=s-past-grace", {
			token: expired,
		});
		expect(((await gone.json()) as { grace_days_remaining: number }).grace_days_remaining).toBe(0);

		expect((await t.call("GET", "/api/billing/subscription", { token })).status).toBe(200);
		expect((await t.call("GET", "/api/sites", { token })).status).toBe(200);
		expect((await t.call("GET", "/api/auth/me", { token })).status).toBe(200);
		expect((await t.call("GET", "/api/tokens", { token })).status).not.toBe(402);

		const sub = (await (await t.call("GET", "/api/billing/subscription", { token })).json()) as {
			data: { trial_expired: boolean; status: string; plan: string };
		};
		expect(sub.data).toMatchObject({ trial_expired: true, status: "trialing", plan: "growth" });
	});

	it("super admins bypass the lapse gate", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({
			id: "u-sa",
			role: "super_admin",
			plan: "micro",
			periodEnd: ago(30),
			withSite: "s-sa",
		});
		const res = await t.call("GET", "/api/analytics/dashboard?site_id=s-sa", { token });
		expect(res.status).toBe(200);
	});
});

describe("plan gates (DEV-34)", () => {
	it("returns 403 plan_required with the tier the feature needs", async () => {
		const t = await createMigratedTestApp();
		const micro = await t.seedUser({ id: "u-micro", plan: "micro", withSite: "s-micro" });
		const starter = await t.seedUser({ id: "u-starter", plan: "starter", withSite: "s-starter" });
		await t.seedUser({ id: "u-friend" });

		const invite = await t.call("POST", "/api/team/invite", {
			token: starter,
			body: { site_id: "s-starter", email: "u-friend@example.com" },
		});
		expect(invite.status).toBe(403);
		expect((await invite.json()) as Record<string, unknown>).toMatchObject({
			success: false,
			error: "plan_required",
			required_plan: "growth",
		});

		const segment = await t.call("POST", "/api/segments", {
			token: micro,
			body: { site_id: "s-micro", name: "x", filters: [] },
		});
		expect(((await segment.json()) as { required_plan: string }).required_plan).toBe("starter");

		const integration = await t.call("POST", "/api/integrations", {
			token: starter,
			body: { site_id: "s-starter", type: "kit", name: "Kit", config: {} },
		});
		expect(((await integration.json()) as { required_plan: string }).required_plan).toBe("growth");

		const provider = await t.call("POST", "/api/payment-providers", {
			token: micro,
			body: { site_id: "s-micro", provider: "stripe", config: {} },
		});
		expect(provider.status).toBe(403);

		const funnel = await t.call("GET", "/api/analytics/funnel?site_id=s-micro", { token: micro });
		expect(((await funnel.json()) as { required_plan: string }).required_plan).toBe("starter");

		const heatmap = await t.call("GET", "/api/analytics/heatmap?site_id=s-starter", {
			token: starter,
		});
		expect((await heatmap.json()) as Record<string, unknown>).toMatchObject({
			error: "plan_required",
			required_plan: "growth",
		});
	});

	it("segments are only listed for sites the caller can access", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-own-seg", plan: "growth", withSite: "s-seg" });
		const other = await t.seedUser({ id: "u-other-seg", plan: "growth" });
		const res = await t.call("GET", "/api/segments?site_id=s-seg", { token: other });
		expect(res.status).toBe(404);
	});
});

describe("team invitations (DEV-34)", () => {
	it("invites stay pending until the invitee accepts", async () => {
		const t = await createMigratedTestApp();
		const owner = await t.seedUser({ id: "u-team-own", plan: "growth", withSite: "s-team" });
		const invitee = await t.seedUser({ id: "u-team-inv", email: "Mixed.Case@Example.com" });

		const res = await t.call("POST", "/api/team/invite", {
			token: owner,
			body: { site_id: "s-team", email: "  mixed.case@example.com " },
		});
		expect(res.status).toBe(201);
		const { data } = (await res.json()) as { data: { id: string; status: string } };
		expect(data.status).toBe("pending");

		// Not a member yet: the owner-gated analytics stay closed to the invitee.
		const before = await t.call("GET", "/api/analytics/visitors?site_id=s-team", {
			token: invitee,
		});
		expect(before.status).toBe(404);

		const pending = (await (
			await t.call("GET", "/api/team/invitations", { token: invitee })
		).json()) as {
			data: { id: string; site_name: string }[];
		};
		expect(pending.data.map((i) => i.id)).toEqual([data.id]);

		const accept = await t.call("POST", `/api/team/invitations/${data.id}/accept`, {
			token: invitee,
		});
		expect(accept.status).toBe(200);
		const after = await t.call("GET", "/api/analytics/visitors?site_id=s-team", { token: invitee });
		expect(after.status).toBe(200);

		const again = await t.call("POST", `/api/team/invitations/${data.id}/accept`, {
			token: owner,
		});
		expect(again.status).toBe(404);
	});
});

describe("trial (DEV-34)", () => {
	it("new signups get a 7-day growth trial with the growth site limit", async () => {
		const t = await createMigratedTestApp();
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "N", email: "new@example.com", password: "password123", plan: "micro" },
		});
		expect(reg.status).toBe(201);
		const { data } = (await reg.json()) as { data: { token: string; intended_plan: string } };
		expect(data.intended_plan).toBe("micro");
		const sub = t.db
			.query(
				"SELECT s.plan, s.status, s.current_period_end FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE u.email = 'new@example.com'",
			)
			.get() as { plan: string; status: string; current_period_end: string };
		expect(sub.plan).toBe("growth");
		expect(sub.status).toBe("trialing");
		const days = (Date.parse(sub.current_period_end) - Date.now()) / DAY;
		expect(days).toBeGreaterThan(6.9);
		expect(days).toBeLessThan(7.1);

		for (const domain of ["a.example.com", "b.example.com", "c.example.com"]) {
			const site = await t.call("POST", "/api/sites", {
				token: data.token,
				body: { name: domain, domain },
			});
			expect(site.status).toBe(201);
		}
	});
});

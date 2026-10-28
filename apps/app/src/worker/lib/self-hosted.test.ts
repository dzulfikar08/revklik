import { describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { appUrl } from "./app-url";
import {
	effectiveSubscription,
	isIngestAllowed,
	isSelfHosted,
	isSubscriptionActive,
} from "./entitlement";
import { pakasirProject } from "./pakasir";
import { getApiRateLimit, getPlanLimits, requirePlan } from "./plans";
import { clearSubscriptionCaches, enforceSiteQuota } from "./subscription-cache";
import { createMigratedTestApp } from "./test-harness";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

describe("SELF_HOSTED flag", () => {
	it("is on only for 1/true", () => {
		expect(isSelfHosted({ SELF_HOSTED: "1" })).toBe(true);
		expect(isSelfHosted({ SELF_HOSTED: " TRUE " })).toBe(true);
		expect(isSelfHosted({ SELF_HOSTED: "0" })).toBe(false);
		expect(isSelfHosted({ SELF_HOSTED: "" })).toBe(false);
		expect(isSelfHosted({})).toBe(false);
		expect(isSelfHosted(undefined)).toBe(false);
	});

	it("makes the entitlement active and unlimited, even for a lapsed or missing subscription", () => {
		const lapsed = { plan: "micro", status: "canceled", current_period_end: ago(60) };
		expect(isSubscriptionActive(lapsed)).toBe(false);
		expect(isIngestAllowed(lapsed)).toBe(false);

		for (const sub of [lapsed, undefined, null]) {
			const effective = effectiveSubscription(sub, true);
			expect(effective).toBeTruthy();
			if (!effective) throw new Error("self-hosted entitlement missing");
			expect(isSubscriptionActive(effective)).toBe(true);
			expect(isIngestAllowed(effective)).toBe(true);
			expect(effective.plan).toBe("growth");
		}
		// Hosted: the stored row is evaluated untouched.
		expect(effectiveSubscription(lapsed, false)).toBe(lapsed);

		expect(getPlanLimits("micro", true).events_per_month).toBeGreaterThan(1e8);
		expect(getPlanLimits("micro", true).sites).toBeGreaterThan(1e8);
		expect(getPlanLimits("micro").sites).toBe(1);
		expect(getApiRateLimit("micro", true)).toBeGreaterThan(getApiRateLimit("growth"));
		expect(getApiRateLimit("micro")).toBe(30);
	});

	it("opens plan tiers for requirePlan only when set", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-tier", plan: "micro" });
		const db = createDb(t.d1);
		expect((await requirePlan(db, "u-tier", 2)).allowed).toBe(false);
		expect(await requirePlan(db, "u-tier", 2, true)).toEqual({ allowed: true, plan: "growth" });
	});

	it("lifts the ingest quota, including a lapsed account", async () => {
		clearSubscriptionCaches();
		const t = await createMigratedTestApp();
		await t.seedUser({
			id: "u-ingest",
			plan: "micro",
			status: "canceled",
			periodEnd: ago(90),
			withSite: "s-ingest",
		});
		const db = createDb(t.d1);
		expect((await enforceSiteQuota(db, "s-ingest")).allowed).toBe(false);
		clearSubscriptionCaches();
		const open = await enforceSiteQuota(db, "s-ingest", true, true);
		expect(open.allowed).toBe(true);
		expect(open.eventsLimit).toBeGreaterThan(1e8);
	});
});

describe("plan-gated routes", () => {
	it("hosted (flag unset) keeps the gates; SELF_HOSTED=1 opens them", async () => {
		const hosted = await createMigratedTestApp();
		const hostedToken = await hosted.seedUser({
			id: "u-h",
			plan: "micro",
			withSite: "s-h",
		});
		await hosted.seedUser({ id: "u-friend-h" });
		const invite = { site_id: "s-h", email: "u-friend-h@example.com" };
		const gated = await hosted.call("POST", "/api/team/invite", {
			token: hostedToken,
			body: invite,
		});
		expect(gated.status).toBe(403);
		expect((await gated.json()) as Record<string, unknown>).toMatchObject({
			error: "plan_required",
			required_plan: "growth",
		});
		expect(
			(await hosted.call("GET", "/api/analytics/funnel?site_id=s-h", { token: hostedToken }))
				.status,
		).toBe(403);
		const secondSite = await hosted.call("POST", "/api/sites", {
			token: hostedToken,
			body: { name: "Two", domain: "two.example.com" },
		});
		expect(secondSite.status).toBe(403);
		expect((await hosted.call("GET", "/api/billing/plans", { token: hostedToken })).status).toBe(
			200,
		);
		const root = (await (await hosted.call("GET", "/api")).json()) as { self_hosted: boolean };
		expect(root.self_hosted).toBe(false);

		const self = await createMigratedTestApp({ SELF_HOSTED: "1" });
		const selfToken = await self.seedUser({ id: "u-s", plan: "micro", withSite: "s-s" });
		await self.seedUser({ id: "u-friend-s" });
		const allowed = await self.call("POST", "/api/team/invite", {
			token: selfToken,
			body: { site_id: "s-s", email: "u-friend-s@example.com" },
		});
		expect(allowed.status).toBe(201);
		expect(
			(await self.call("GET", "/api/analytics/funnel?site_id=s-s", { token: selfToken })).status,
		).toBe(200);
		const extraSite = await self.call("POST", "/api/sites", {
			token: selfToken,
			body: { name: "Two", domain: "two.example.com" },
		});
		expect(extraSite.status).toBe(201);
		const selfRoot = (await (await self.call("GET", "/api")).json()) as {
			self_hosted: boolean;
		};
		expect(selfRoot.self_hosted).toBe(true);
		const me = (await (await self.call("GET", "/api/auth/me", { token: selfToken })).json()) as {
			data: { self_hosted: boolean };
		};
		expect(me.data.self_hosted).toBe(true);
	});

	it("a lapsed account keeps reading analytics when self-hosted, gets 402 when hosted", async () => {
		const lapsed = {
			id: "u-lapsed-sh",
			plan: "growth",
			status: "trialing",
			periodEnd: ago(40),
			withSite: "s-lapsed-sh",
		};
		const hosted = await createMigratedTestApp();
		const hostedToken = await hosted.seedUser(lapsed);
		expect(
			(
				await hosted.call("GET", "/api/analytics/dashboard?site_id=s-lapsed-sh", {
					token: hostedToken,
				})
			).status,
		).toBe(402);

		const self = await createMigratedTestApp({ SELF_HOSTED: "1" });
		const selfToken = await self.seedUser(lapsed);
		expect(
			(
				await self.call("GET", "/api/analytics/dashboard?site_id=s-lapsed-sh", {
					token: selfToken,
				})
			).status,
		).toBe(200);
		// The App Store Connect routes sit behind the same subscription gate.
		expect(
			(
				await self.call("GET", "/api/appstoreconnect/status?site_id=s-lapsed-sh", {
					token: selfToken,
				})
			).status,
		).not.toBe(402);
	});
});

describe("hosted-only billing when self-hosted", () => {
	it("switches off checkout, plans, subscription webhooks, referrals and trials", async () => {
		const t = await createMigratedTestApp({ SELF_HOSTED: "1" });
		const token = await t.seedUser({ id: "u-bill" });

		for (const [method, path] of [
			["GET", "/api/billing/plans"],
			["POST", "/api/billing/checkout"],
			["POST", "/api/billing/checkout/pakasir"],
			["POST", "/api/billing/pakasir/verify"],
			["POST", "/api/billing/cancel"],
			["GET", "/api/affiliates"],
		] as const) {
			expect((await t.call(method, path, { token, body: {} })).status).toBe(404);
		}
		for (const path of ["/api/billing/webhook", "/api/webhooks/pakasir"]) {
			expect((await t.call("POST", path, { body: {} })).status).toBe(404);
		}

		const sub = (await (await t.call("GET", "/api/billing/subscription", { token })).json()) as {
			data: {
				plan: string;
				status: string;
				self_hosted: boolean;
				usage: { sites: { limit: number } };
			};
		};
		expect(sub.data).toMatchObject({ plan: "growth", status: "active", self_hosted: true });
		expect(sub.data.usage.sites.limit).toBeGreaterThan(1e8);
		// Email preferences share the /billing prefix but are not billing.
		expect((await t.call("GET", "/api/billing/alerts", { token })).status).toBe(200);

		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "N", email: "fresh@example.com", password: "password123" },
		});
		expect(reg.status).toBe(201);
		const rows = t.db
			.query(
				"SELECT COUNT(*) AS n FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE u.email = 'fresh@example.com'",
			)
			.get() as { n: number };
		expect(rows.n).toBe(0);
	});
});

describe("deployment settings default to the hosted values", () => {
	it("APP_URL", () => {
		expect(appUrl({})).toBe("https://app.revklik.com");
		expect(appUrl({ APP_URL: "https://stats.example.org/" })).toBe("https://stats.example.org");
	});

	it("PAKASIR_PROJECT", () => {
		expect(pakasirProject({})).toBe("revklik");
		expect(pakasirProject({ PAKASIR_PROJECT: " my-shop " })).toBe("my-shop");
	});
});

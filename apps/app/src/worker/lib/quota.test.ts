import { describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { getAccountEventsUsed, usageMonth } from "./account-usage";
import { isIngestAllowed, isSubscriptionActive, isTrialExpired } from "./entitlement";
import { clearSubscriptionCaches, enforceSiteQuota } from "./subscription-cache";
import { createMigratedTestApp } from "./test-harness";

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const DAY = 86_400_000;
const pageview = (site: string, i: number) => ({
	s: site,
	sid: `sid-${site}`,
	vid: `vid-${site}`,
	t: "p",
	p: `/p${i}`,
});

describe("entitlement", () => {
	it("keeps ingest open for 14 days past period end, dashboard access only inside it", () => {
		const now = Date.parse("2026-10-11T00:00:00Z");
		const at = (days: number) => new Date(now + days * DAY).toISOString();
		const sub = (status: string, end: string) => ({
			plan: "starter",
			status,
			current_period_end: end,
		});
		expect(isSubscriptionActive(sub("active", at(3)), now)).toBe(true);
		expect(isSubscriptionActive(sub("active", at(-1)), now)).toBe(false);
		expect(isIngestAllowed(sub("active", at(-13)), now)).toBe(true);
		expect(isIngestAllowed(sub("active", at(-15)), now)).toBe(false);
		expect(isSubscriptionActive(sub("canceled", at(3)), now)).toBe(false);
		expect(isTrialExpired(sub("trialing", at(-1)), now)).toBe(true);
		expect(isTrialExpired(sub("active", at(-1)), now)).toBe(false);
	});
});

describe("account quota (DEV-34)", () => {
	it("seeds the counter from a COUNT when the month row is missing", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-cnt", plan: "micro", withSite: "s-cnt" });
		for (let i = 0; i < 3; i++) {
			t.db
				.prepare(
					"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES (?,?,?,?,?,?)",
				)
				.run(`e${i}`, "s-cnt", "s", "v", new Date().toISOString(), "/");
		}
		const db = createDb(t.d1);
		expect(await getAccountEventsUsed(db, "u-cnt")).toBe(3);
		const row = t.db
			.query("SELECT events FROM account_usage WHERE user_id = 'u-cnt' AND month = ?")
			.get(usageMonth()) as { events: number };
		expect(row.events).toBe(3);
	});

	it("counts every site of the owner against one limit", async () => {
		clearSubscriptionCaches();
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-acct", plan: "micro", withSite: "s-acct-a" });
		t.db
			.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)")
			.run("s-acct-b", "u-acct", "B", "b.example.com", new Date().toISOString());
		t.db
			.prepare("INSERT INTO account_usage (user_id, month, events) VALUES (?,?,?)")
			.run("u-acct", usageMonth(), 10_000);
		const res = await enforceSiteQuota(createDb(t.d1), "s-acct-b");
		expect(res.allowed).toBe(false);
		expect(res.reason).toBe("quota_exceeded");
	});

	it("batches are capped at 50 and every ingested event increments the counter", async () => {
		clearSubscriptionCaches();
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-batch", plan: "growth", withSite: "s-batch" });
		const headers = { "user-agent": BROWSER_UA };

		const tooBig = Array.from({ length: 51 }, (_, i) => pageview("s-batch", i));
		expect((await t.call("POST", "/api/track", { headers, body: tooBig })).status).toBe(413);

		const batch = Array.from({ length: 3 }, (_, i) => pageview("s-batch", i));
		expect((await t.call("POST", "/api/track", { headers, body: batch })).status).toBe(202);
		const events = t.db
			.query("SELECT COUNT(*) AS n FROM events WHERE site_id = 's-batch'")
			.get() as {
			n: number;
		};
		expect(events.n).toBe(3);
		const session = t.db
			.query("SELECT page_count FROM sessions WHERE id = 'sid-s-batch'")
			.get() as {
			page_count: number;
		};
		expect(session.page_count).toBe(3);
		const usage = t.db
			.query("SELECT events FROM account_usage WHERE user_id = 'u-batch'")
			.get() as { events: number };
		expect(usage.events).toBe(3);
	});

	it("ingest keeps flowing during the 14-day grace period, then drops", async () => {
		clearSubscriptionCaches();
		const t = await createMigratedTestApp();
		await t.seedUser({
			id: "u-grace",
			plan: "starter",
			withSite: "s-grace",
			periodEnd: new Date(Date.now() - 5 * DAY).toISOString(),
		});
		await t.seedUser({
			id: "u-lapsed",
			plan: "starter",
			withSite: "s-lapsed",
			periodEnd: new Date(Date.now() - 20 * DAY).toISOString(),
		});
		const db = createDb(t.d1);
		expect((await enforceSiteQuota(db, "s-grace")).allowed).toBe(true);
		const lapsed = await enforceSiteQuota(db, "s-lapsed");
		expect(lapsed.allowed).toBe(false);
		expect(lapsed.reason).toBe("subscription_expired");
	});
});

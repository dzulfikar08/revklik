import { describe, expect, it } from "bun:test";
import { purgeExpiredRows, retentionPurgeDays } from "./purge";
import { createMigratedTestApp, type MigratedTestApp } from "./test-harness";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function addEvent(
	t: MigratedTestApp,
	site: string,
	id: string,
	daysAgo: number,
	extra: { revenue?: number | null; externalId?: string | null } = {},
) {
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, revenue, external_id) VALUES (?,?,?,?,?,?,?,?,?)",
		)
		.run(
			id,
			site,
			"s",
			"v",
			ago(daysAgo),
			"pageview",
			"/",
			extra.revenue ?? null,
			extra.externalId ?? null,
		);
}

const ids = (t: MigratedTestApp, table: string, site: string) =>
	(
		t.db.query(`SELECT id FROM ${table} WHERE site_id = ? ORDER BY id`).all(site) as {
			id: string;
		}[]
	).map((r) => r.id);

describe("retention purge: plan windows", () => {
	it("keeps twice the plan's reporting window, never under 30 days (30/60/180)", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-micro", plan: "micro", withSite: "s-micro" });
		await t.seedUser({ id: "u-starter", plan: "starter", withSite: "s-starter" });
		await t.seedUser({ id: "u-growth", plan: "growth", withSite: "s-growth" });
		for (const [site, keep, drop] of [
			["s-micro", 29, 31],
			["s-starter", 59, 61],
			["s-growth", 179, 181],
		] as const) {
			addEvent(t, site, `${site}-keep`, keep);
			addEvent(t, site, `${site}-drop`, drop);
		}

		const deleted = await purgeExpiredRows(t.d1, { selfHosted: false });

		expect(deleted).toBe(3);
		for (const site of ["s-micro", "s-starter", "s-growth"]) {
			expect(ids(t, "events", site)).toEqual([`${site}-keep`]);
		}
	});

	it("deletes expired sessions and visitor profiles with their personal fields, keeps recent ones", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-p", plan: "micro", withSite: "s-p" });
		t.db
			.prepare(
				"INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES ('old','s-p','v1',?), ('new','s-p','v2',?)",
			)
			.run(ago(45), ago(2));
		t.db
			.prepare(
				"INSERT INTO visitor_profiles (id, site_id, visitor_id, name, email, last_seen) VALUES ('p-old','s-p','v1','Old','old@example.com',?), ('p-new','s-p','v2','New','new@example.com',?)",
			)
			.run(ago(45), ago(2));

		await purgeExpiredRows(t.d1, { selfHosted: false });

		expect(ids(t, "sessions", "s-p")).toEqual(["new"]);
		expect(ids(t, "visitor_profiles", "s-p")).toEqual(["p-new"]);
	});

	it("keeps payment events past the window: money, refunds and provider references", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-pay", plan: "micro", withSite: "s-pay" });
		addEvent(t, "s-pay", "sale", 400, { revenue: 49_000 });
		addEvent(t, "s-pay", "refund", 400, { revenue: -49_000 });
		addEvent(t, "s-pay", "ref-only", 400, { externalId: "polar:ord_1" });
		addEvent(t, "s-pay", "zero-conversion", 400, { revenue: 0 });
		addEvent(t, "s-pay", "plain-view", 400);

		await purgeExpiredRows(t.d1, { selfHosted: false });

		expect(ids(t, "events", "s-pay")).toEqual(["ref-only", "refund", "sale"]);
	});

	it("never touches a super admin's data and ignores RETENTION_HARD_DELETE_DAYS on hosted", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-root", role: "super_admin", plan: "micro", withSite: "s-root" });
		await t.seedUser({ id: "u-x", plan: "growth", withSite: "s-x" });
		addEvent(t, "s-root", "ancient", 900);
		addEvent(t, "s-x", "ninety", 90);

		const deleted = await purgeExpiredRows(t.d1, { selfHosted: false, hardDeleteDays: "30" });

		expect(deleted).toBe(0);
		expect(ids(t, "events", "s-root")).toEqual(["ancient"]);
		expect(ids(t, "events", "s-x")).toEqual(["ninety"]);
	});

	it("stops at the statement budget and finishes the remaining sites on the next run", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-b1", plan: "micro", withSite: "s-b1" });
		await t.seedUser({ id: "u-b2", plan: "micro", withSite: "s-b2" });
		addEvent(t, "s-b1", "old1", 100);
		addEvent(t, "s-b2", "old2", 100);

		// One round over the 8 retention tables is 8 statements, so a budget of 8 covers one site.
		const opts = { selfHosted: false, statementBudget: 8 };
		expect(await purgeExpiredRows(t.d1, opts)).toBe(1);
		expect(await purgeExpiredRows(t.d1, opts)).toBe(1);
		expect(await purgeExpiredRows(t.d1, opts)).toBe(0);
		expect(ids(t, "events", "s-b1").concat(ids(t, "events", "s-b2"))).toEqual([]);
	});
});

describe("retentionPurgeDays", () => {
	it("hosted: doubles the plan window with a 30-day floor; unknown plans count as Micro", () => {
		const hosted = { selfHosted: false, role: "user" } as const;
		expect(retentionPurgeDays({ ...hosted, plan: "micro" })).toBe(30);
		expect(retentionPurgeDays({ ...hosted, plan: "starter" })).toBe(60);
		expect(retentionPurgeDays({ ...hosted, plan: "growth" })).toBe(180);
		expect(retentionPurgeDays({ ...hosted, plan: null })).toBe(30);
		expect(retentionPurgeDays({ ...hosted, plan: "free" })).toBe(30);
		expect(
			retentionPurgeDays({ selfHosted: false, role: "super_admin", plan: "growth" }),
		).toBeNull();
	});

	it("self-hosted: keeps everything unless RETENTION_HARD_DELETE_DAYS is a number of at least 30", () => {
		const base = { selfHosted: true, plan: null, role: "user" } as const;
		expect(retentionPurgeDays(base)).toBeNull();
		expect(retentionPurgeDays({ ...base, hardDeleteDays: "abc" })).toBeNull();
		expect(retentionPurgeDays({ ...base, hardDeleteDays: "29" })).toBeNull();
		expect(retentionPurgeDays({ ...base, hardDeleteDays: "365" })).toBe(365);
	});
});

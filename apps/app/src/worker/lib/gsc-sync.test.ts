import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { makeD1, seedSiteWithSessionKey, type D1Like } from "./test-harness";
import { migrateDatabase } from "../migrations";
import { createDb } from "../db";
import { GSC_BACKFILL_DAYS, syncAllGsc, syncGscIntegration } from "./gsc-sync";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-06T10:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});

/** Google mock: OAuth token endpoint plus Search Analytics returning `rowsPerDay` queries for every day asked. */
function mockGoogle(rowsPerDay = 2) {
	const days: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.startsWith("https://oauth2.googleapis.com/token"))
			return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
		if (url.includes("/searchAnalytics/query")) {
			const body = JSON.parse(String(init?.body)) as { startDate: string };
			days.push(body.startDate);
			const rows = Array.from({ length: rowsPerDay }, (_, i) => ({
				keys: [`q${i}`],
				clicks: 1,
				impressions: 10,
				ctr: 0.1,
				position: 3,
			}));
			return new Response(JSON.stringify({ rows }), { status: 200 });
		}
		return new Response("not mocked", { status: 500 });
	}) as typeof fetch;
	return days;
}

async function setup(extra: { synced_through?: string; last_sync?: string } = {}) {
	const d1 = makeD1(new Database(":memory:"));
	await migrateDatabase(d1 as unknown as D1Database);
	const db = createDb(d1 as unknown as D1Database);
	await seedSiteWithSessionKey(d1 as unknown as D1Like);
	await db
		.insertInto("integrations")
		.values({
			id: "i1",
			site_id: "s1",
			user_id: "u1",
			type: "google_search_console",
			name: "Google Search Console",
			config: JSON.stringify({ refresh_token: "rt", google_site_url: "sc-domain:example.com" }),
			enabled: 1,
			created_at: new Date(NOW).toISOString(),
			last_sync: extra.last_sync ?? null,
			synced_through: extra.synced_through ?? null,
		})
		.execute();
	return db;
}

const creds = { clientId: "c", clientSecret: "s" };

describe("GSC sync", () => {
	it("backfills from the first run within the budget and resumes where it stopped", async () => {
		const db = await setup();
		const asked = mockGoogle();
		const first = await syncAllGsc(db, creds, { now: NOW, budget: { n: 0, max: 11 } });
		expect(first[0]?.days_synced).toBe(10); // 1 token call + 10 days
		expect(first[0]?.budget_exhausted).toBe(true);
		expect(asked[0]).toBe(iso(2 + GSC_BACKFILL_DAYS - 1));
		expect(first[0]?.synced_through).toBe(asked[9]);

		const second = await syncAllGsc(db, creds, { now: NOW, budget: { n: 0, max: 11 } });
		// Resumes a few days before the cursor (GSC data settles), never from the start again.
		expect(asked[10]).toBe(new Date(Date.parse(`${asked[9]}T00:00:00Z`) - 3 * DAY).toISOString().slice(0, 10));
		expect(second[0]?.synced_through && second[0].synced_through > (first[0]?.synced_through ?? "")).toBe(true);
	});

	it("re-syncing a day replaces its rows instead of duplicating them", async () => {
		const db = await setup();
		mockGoogle(25); // more than one insert chunk
		const integration = await db.selectFrom("integrations").selectAll().executeTakeFirstOrThrow();
		await syncGscIntegration(db, integration, creds, { budget: { n: 0, max: 50 }, days: 3, now: NOW });
		await syncGscIntegration(db, integration, creds, { budget: { n: 0, max: 50 }, days: 3, now: NOW });
		const rows = await db
			.selectFrom("search_console_data")
			.select(({ fn }) => fn.countAll<number>().as("n"))
			.executeTakeFirstOrThrow();
		expect(Number(rows.n)).toBe(3 * 25);
		const after = await db.selectFrom("integrations").select(["synced_through", "last_sync"]).executeTakeFirstOrThrow();
		expect(after.synced_through).toBe(iso(2));
		expect(after.last_sync).not.toBeNull();
	});

	it("skips a caught-up integration synced recently and refreshes it once it is stale", async () => {
		const fresh = await setup({ synced_through: iso(2), last_sync: new Date(NOW - 2 * 3_600_000).toISOString() });
		const asked = mockGoogle();
		expect(await syncAllGsc(fresh, creds, { now: NOW })).toEqual([]);
		expect(asked).toEqual([]);

		const stale = await setup({ synced_through: iso(2), last_sync: new Date(NOW - 25 * 3_600_000).toISOString() });
		const r = await syncAllGsc(stale, creds, { now: NOW });
		expect(r[0]?.days_synced).toBe(4); // the settling window only
	});
});

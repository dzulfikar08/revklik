import { describe, expect, it } from "bun:test";
import { normalizeDomain } from "../routes/sites";
import { getFeatures } from "./plans";
import { PURGE_CHUNK, purgeExpiredRows } from "./purge";
import { createMigratedTestApp, type MigratedTestApp } from "./test-harness";

const DAY = 86_400_000;

function addEvent(t: MigratedTestApp, site: string, daysAgo: number, id = crypto.randomUUID()) {
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path) VALUES (?,?,?,?,?,?,?)",
		)
		.run(
			id,
			site,
			"s",
			`v-${id}`,
			new Date(Date.now() - daysAgo * DAY).toISOString(),
			"pageview",
			"/",
		);
}

const count = (t: MigratedTestApp, table: string, site?: string) =>
	(
		t.db
			.query(`SELECT COUNT(*) AS n FROM ${table}${site ? " WHERE site_id = ?" : ""}`)
			.get(...(site ? [site] : [])) as { n: number }
	).n;

describe("domain normalisation (DEV-34)", () => {
	it("strips scheme, path, port, trailing dot and www", () => {
		expect(normalizeDomain("https://WWW.Example.com/pricing?x=1")).toBe("example.com");
		expect(normalizeDomain("http://shop.example.co.id:8080/")).toBe("shop.example.co.id");
		expect(normalizeDomain("example.com.")).toBe("example.com");
		expect(normalizeDomain("  Example.COM/ ")).toBe("example.com");
		expect(normalizeDomain("not a domain")).toBeNull();
		expect(normalizeDomain("https://")).toBeNull();
	});

	it("POST /sites stores the normalised domain", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-dom", plan: "growth" });
		const res = await t.call("POST", "/api/sites", {
			token,
			body: { name: "Shop", domain: "https://www.Shop.Example.com/" },
		});
		expect(res.status).toBe(201);
		const row = t.db.query("SELECT domain FROM sites WHERE user_id = 'u-dom'").get() as {
			domain: string;
		};
		expect(row.domain).toBe("shop.example.com");
		const bad = await t.call("POST", "/api/sites", { token, body: { name: "x", domain: "%%" } });
		expect(bad.status).toBe(400);
	});
});

describe("site delete (DEV-35)", () => {
	it("removes dependent rows across tables in chunks and leaves other sites alone", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-del", plan: "growth", withSite: "s-del" });
		t.db
			.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)")
			.run("s-keep", "u-del", "keep", "keep.example.com", new Date().toISOString());
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES (?,?,?,?,?,?)",
		);
		t.db.transaction(() => {
			for (let i = 0; i < PURGE_CHUNK + 7; i++) {
				insert.run(`e-${i}`, "s-del", "s", "v", new Date().toISOString(), "/");
			}
		})();
		addEvent(t, "s-keep", 0);
		t.db.exec(`
			INSERT INTO sessions (id, site_id, visitor_id) VALUES ('ss1', 's-del', 'v');
			INSERT INTO heatmap_clicks (id, site_id, session_id, visitor_id, path, x, y) VALUES ('h1', 's-del', 's', 'v', '/', 1, 1);
			INSERT INTO crawler_hits (id, site_id, bot, category) VALUES ('c1', 's-del', 'GPTBot', 'training');
			INSERT INTO session_recordings (id, site_id, session_id, visitor_id, path, events) VALUES ('r1', 's-del', 's', 'v', '/', '[]');
			INSERT INTO integrations (id, site_id, user_id, type, name, config) VALUES ('i1', 's-del', 'u-del', 'kit', 'Kit', '{}');
			INSERT INTO api_keys (id, user_id, key_hash, key_prefix, token_type, site_id) VALUES ('k1', 'u-del', 'h-site', 'rv_', 'site', 's-del');
		`);

		const res = await t.call("DELETE", "/api/sites/s-del", { token });
		expect(res.status).toBe(200);
		for (const table of [
			"events",
			"sessions",
			"heatmap_clicks",
			"crawler_hits",
			"session_recordings",
			"integrations",
			"api_keys",
		]) {
			expect(count(t, table, "s-del")).toBe(0);
		}
		expect(count(t, "events", "s-keep")).toBe(1);
		expect(t.db.query("SELECT id FROM sites WHERE id = 's-del'").get()).toBeNull();
	});
});

describe("retention (DEV-35)", () => {
	it("hard delete is off unless RETENTION_HARD_DELETE_DAYS is set", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-ret", plan: "growth", withSite: "s-ret" });
		addEvent(t, "s-ret", 400);
		addEvent(t, "s-ret", 1);
		expect(await purgeExpiredRows(t.d1, undefined)).toBe(0);
		expect(await purgeExpiredRows(t.d1, "")).toBe(0);
		expect(count(t, "events", "s-ret")).toBe(2);
		expect(await purgeExpiredRows(t.d1, "365")).toBe(1);
		expect(count(t, "events", "s-ret")).toBe(1);
	});

	it("dashboard reads are clamped to the plan's retention window", async () => {
		const t = await createMigratedTestApp();
		const micro = await t.seedUser({ id: "u-r-micro", plan: "micro", withSite: "s-r-micro" });
		const growth = await t.seedUser({ id: "u-r-growth", plan: "growth", withSite: "s-r-growth" });
		for (const site of ["s-r-micro", "s-r-growth"]) {
			addEvent(t, site, 1);
			addEvent(t, site, 20);
		}
		const views = async (token: string, site: string) =>
			(
				(await (
					await t.call("GET", `/api/analytics/dashboard?site_id=${site}&range=30d`, { token })
				).json()) as { data: { stats: { pageviews: number } } }
			).data.stats.pageviews;
		expect(await views(micro, "s-r-micro")).toBe(1);
		expect(await views(growth, "s-r-growth")).toBe(2);
	});
});

describe("schema and copy (DEV-35)", () => {
	it("drops the unused events payment index", async () => {
		const t = await createMigratedTestApp();
		const idx = t.db
			.query(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_events_site_payment'",
			)
			.get();
		expect(idx).toBeNull();
	});

	it("plan copy states the real gzipped tracker size", () => {
		for (const tier of ["micro", "starter", "growth"] as const) {
			expect(getFeatures(tier).some((f) => f.includes("<1KB"))).toBe(false);
		}
		expect(getFeatures("micro")).toContain("<4KB gzipped script");
	});
});

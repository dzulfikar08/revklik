import { afterEach, describe, expect, it } from "bun:test";
import { convertAmount, usdRates } from "../lib/fx";
import { resolveEventTimestamp, sanitizeRevenue } from "../lib/ingest";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { bucketKeys } from "./analytics";

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function insertRevenue(t: MigratedTestApp, site: string, amount: number, currency: string | null) {
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, revenue, currency) VALUES (?,?,?,?,?,?,?,?,?)",
		)
		.run(
			crypto.randomUUID(),
			site,
			"s",
			"v",
			new Date().toISOString(),
			"conversion",
			"/",
			amount,
			currency,
		);
}

describe("fx", () => {
	it("converts through USD and treats unknown currencies as USD", () => {
		const rates = usdRates({ FX_USD_IDR: "15000" });
		expect(convertAmount(15_000, "IDR", "USD", rates)).toBeCloseTo(1);
		expect(convertAmount(1, "USD", "IDR", rates)).toBe(15_000);
		expect(convertAmount(5, "XYZ", "USD", rates)).toBe(5);
		expect(usdRates().IDR).toBe(16_000);
	});
});

describe("ingest validation", () => {
	it("sanitizes revenue", () => {
		expect(sanitizeRevenue(12.5)).toBe(12.5);
		expect(sanitizeRevenue(-1)).toBeNull();
		expect(sanitizeRevenue(Number.NaN)).toBeNull();
		expect(sanitizeRevenue(Number.POSITIVE_INFINITY)).toBeNull();
		expect(sanitizeRevenue(2e9)).toBeNull();
		expect(sanitizeRevenue("7")).toBe(7);
	});

	it("clamps client timestamps to server time outside [now-48h, now+5m]", () => {
		const now = Date.parse("2026-10-11T12:00:00Z");
		const nowIso = new Date(now).toISOString();
		expect(resolveEventTimestamp("garbage", now)).toBe(nowIso);
		expect(resolveEventTimestamp(now + 10 * 60_000, now)).toBe(nowIso);
		expect(resolveEventTimestamp(now - 49 * 3_600_000, now)).toBe(nowIso);
		expect(resolveEventTimestamp(now - 60_000, now)).toBe(new Date(now - 60_000).toISOString());
		expect(resolveEventTimestamp(undefined, now)).toBe(nowIso);
	});

	it("an invalid ts on /api/track is stored at server time instead of a 500", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-tr", plan: "growth", withSite: "s-tr" });
		const res = await t.call("POST", "/api/track", {
			headers: { "user-agent": BROWSER_UA },
			body: { s: "s-tr", sid: "sid1", vid: "vid1", t: "c", p: "/buy", ts: "not-a-date", rv: -50 },
		});
		expect(res.status).toBe(202);
		const row = t.db
			.query("SELECT timestamp, revenue FROM events WHERE site_id = 's-tr'")
			.get() as {
			timestamp: string;
			revenue: number | null;
		};
		expect(Math.abs(Date.parse(row.timestamp) - Date.now())).toBeLessThan(60_000);
		expect(row.revenue).toBeNull();
	});
});

describe("currency-aware revenue", () => {
	it("converts mixed currencies into the site's display currency and reports it", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-fx", plan: "growth", withSite: "s-fx" });
		insertRevenue(t, "s-fx", 10, "USD");
		insertRevenue(t, "s-fx", 160_000, "IDR");
		insertRevenue(t, "s-fx", 5, null);

		const usd = await t.call("GET", "/api/analytics/dashboard?site_id=s-fx&range=7d", { token });
		const usdBody = (await usd.json()) as {
			currency: string;
			data: { currency: string; stats: { revenue: number } };
		};
		expect(usdBody.currency).toBe("USD");
		expect(usdBody.data.currency).toBe("USD");
		expect(usdBody.data.stats.revenue).toBeCloseTo(25);

		const patch = await t.call("PATCH", "/api/sites/s-fx", {
			token,
			body: { revenue_currency: "idr" },
		});
		expect(patch.status).toBe(200);
		const idr = await t.call("GET", "/api/analytics/dashboard?site_id=s-fx&range=30d", { token });
		const idrBody = (await idr.json()) as {
			data: { currency: string; stats: { revenue: number } };
		};
		expect(idrBody.data.currency).toBe("IDR");
		expect(idrBody.data.stats.revenue).toBeCloseTo(400_000);

		const bad = await t.call("PATCH", "/api/sites/s-fx", {
			token,
			body: { revenue_currency: "ZZZ" },
		});
		expect(bad.status).toBe(400);
	});
});

describe("timezone buckets", () => {
	it("bucketKeys shifts day boundaries by the offset and keeps the partial last day", () => {
		const keys = bucketKeys("2026-01-01T20:00:00.000Z", "2026-01-03T01:00:00.000Z", false, 420);
		expect(keys).toEqual(["2026-01-02", "2026-01-03"]);
		expect(bucketKeys("2026-01-01T20:00:00.000Z", "2026-01-03T01:00:00.000Z", false)).toEqual([
			"2026-01-01",
			"2026-01-02",
			"2026-01-03",
		]);
	});

	it("dashboard timeseries buckets by the tz query param", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-tz", plan: "growth", withSite: "s-tz" });
		// 20:00 UTC yesterday is already "today" at UTC+7 when now is past 17:00 UTC.
		const late = new Date();
		late.setUTCDate(late.getUTCDate() - 3);
		late.setUTCHours(20, 0, 0, 0);
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path) VALUES (?,?,?,?,?,?,?)",
			)
			.run("e-tz", "s-tz", "s", "v", late.toISOString(), "pageview", "/");
		const localDay = new Date(late.getTime() + 420 * 60_000).toISOString().slice(0, 10);
		const utcDay = late.toISOString().slice(0, 10);

		const utc = (await (
			await t.call("GET", "/api/analytics/dashboard?site_id=s-tz&range=7d", { token })
		).json()) as { data: { timeseries: { date: string; pageviews: number }[] } };
		expect(utc.data.timeseries.find((p) => p.pageviews > 0)?.date).toBe(utcDay);

		const wib = (await (
			await t.call("GET", "/api/analytics/dashboard?site_id=s-tz&range=7d&tz=420", { token })
		).json()) as { data: { timeseries: { date: string; pageviews: number }[] } };
		expect(wib.data.timeseries.find((p) => p.pageviews > 0)?.date).toBe(localDay);
	});
});

describe("RevKlik's own payments stay out of customer analytics", () => {
	it("Polar subscription webhooks with visitor metadata write no events", async () => {
		const secret = "polar_whs_x";
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: secret });
		await t.seedUser({ id: "u-own", withSite: "s-own" });
		const body = JSON.stringify({
			type: "subscription.active",
			data: {
				id: "sub_own",
				status: "active",
				metadata: { user_id: "u-own", plan: "growth", klikapa_visitor_id: "vis-1" },
			},
		});
		const ts = String(Math.floor(Date.now() / 1000));
		const res = await t.call("POST", "/api/billing/webhook", {
			body,
			headers: {
				"webhook-id": "w1",
				"webhook-timestamp": ts,
				"webhook-signature": await signStandardWebhook(body, "w1", ts, secret),
			},
		});
		expect(res.status).toBe(200);
		expect((t.db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(0);
	});

	it("Pakasir activation writes no events", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		const token = await t.seedUser({ id: "u-own2", withSite: "s-own2" });
		const checkout = await t.call("POST", "/api/billing/checkout/pakasir", {
			token,
			body: { plan: "starter" },
		});
		const { data } = (await checkout.json()) as { data: { order_id: string } };
		globalThis.fetch = (async () =>
			Response.json({
				transaction: { amount: 64_000, order_id: data.order_id, status: "completed" },
			})) as unknown as typeof fetch;
		await t.call("POST", "/api/webhooks/pakasir", {
			body: { amount: 64_000, order_id: data.order_id, project: "revklik", status: "completed" },
		});
		expect((t.db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(0);
	});
});

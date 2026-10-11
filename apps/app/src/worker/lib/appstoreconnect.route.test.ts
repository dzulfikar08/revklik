import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { createRouteTables, makeD1, seedSiteWithSessionKey, type D1Like } from "./test-harness";

describe("appstoreconnect routes", () => {
	it("gates metrics behind auth and serves stored data for a session token", async () => {
		const db = new Database(":memory:");
		createRouteTables(db);
		const d1 = makeD1(db);
		const { token, siteId } = await seedSiteWithSessionKey(d1);

		const app = createApp();
		const env = { DB: d1, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } };

		// No token → 401 before any data access.
		const anon = await app.request(
			`/api/appstoreconnect/metrics?site_id=${siteId}`,
			undefined,
			env,
		);
		expect(anon.status).toBe(401);

		// With a session token → metrics endpoint answers for the seeded site.
		const today = new Date().toISOString().slice(0, 10);
		db.prepare(
			"INSERT INTO asc_daily_metrics (id, site_id, app_id, date, units, proceeds, iap_units, iap_proceeds, synced_at) VALUES (?,?,?,?,?,?,?,?,?)",
		).run("m1", siteId, "123456789", today, 5, 3.5, 0, 0, today);

		const authed = await app.request(
			`/api/appstoreconnect/metrics?site_id=${siteId}&range=7d`,
			{ headers: { Authorization: `Bearer ${token}` } },
			env,
		);
		expect(authed.status).toBe(200);
		const body = (await authed.json()) as {
			success: boolean;
			data: { totals: { downloads: number; proceeds: number }; timeseries: unknown[] };
		};
		expect(body.success).toBe(true);
		expect(body.data.totals.downloads).toBe(5);

		// Sync without an appstoreconnect integration → 404 (not a crash).
		const syncRes = await app.request(
			"/api/appstoreconnect/sync",
			{
				method: "POST",
				body: JSON.stringify({ site_id: siteId }),
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
			},
			env,
		);
		expect(syncRes.status).toBe(404);

		// Integrations are a Growth feature.
		db.prepare(
			"INSERT INTO subscriptions (id, user_id, plan, status, current_period_end) VALUES ('sub-u1', 'u1', 'growth', 'active', ?)",
		).run(new Date(Date.now() + 86_400_000).toISOString());

		// Creating the integration works, private_key is masked on read, and a
		// partial PATCH merges instead of wiping the other fields.
		const created = await app.request(
			"/api/integrations",
			{
				method: "POST",
				body: JSON.stringify({
					site_id: siteId,
					type: "appstoreconnect",
					name: "App Store",
					config: {
						issuer_id: "iss",
						key_id: "kid",
						private_key: "PEM-BODY",
						app_id: "123456789",
						vendor_number: "v1",
					},
				}),
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			},
			env,
		);
		expect(created.status).toBe(201);
		const { data: createdBody } = (await created.json()) as { data: { id: string } };

		const listRes = await app.request(
			`/api/integrations?site_id=${siteId}`,
			{ headers: { Authorization: `Bearer ${token}` } },
			env,
		);
		const { data: list } = (await listRes.json()) as {
			data: Array<{ config: Record<string, string> }>;
		};
		expect(list[0].config.private_key).toMatch(/^\*\*\*\*/);
		expect(list[0].config.issuer_id).toBe("iss");

		// QRIS checkout is geo-gated: non-ID visitors are rejected, ID passes
		// the gate (then fails on the junk plan).
		const qrisUs = await app.request(
			"/api/billing/checkout/pakasir",
			{
				method: "POST",
				body: JSON.stringify({ plan: "growth" }),
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"CF-IPCountry": "US",
				},
			},
			env,
		);
		expect(qrisUs.status).toBe(403);
		const qrisId = await app.request(
			"/api/billing/checkout/pakasir",
			{
				method: "POST",
				body: JSON.stringify({ plan: "nope" }),
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"CF-IPCountry": "ID",
				},
			},
			env,
		);
		expect(qrisId.status).toBe(400);

		const patched = await app.request(
			`/api/integrations/${createdBody.id}`,
			{
				method: "PATCH",
				body: JSON.stringify({ config: { vendor_number: "v2" } }),
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			},
			env,
		);
		const { data: patchedBody } = (await patched.json()) as {
			data: { config: Record<string, string> };
		};
		expect(patchedBody.config.vendor_number).toBe("v2");
		expect(patchedBody.config.private_key).toBe("****BODY");
		expect(patchedBody.config.issuer_id).toBe("iss");
		expect(body.data.totals.proceeds).toBeCloseTo(3.5);
		expect(body.data.timeseries).toHaveLength(1);
	});
});

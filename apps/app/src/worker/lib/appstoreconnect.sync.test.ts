import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { makeD1, seedSiteWithSessionKey, type D1Like } from "./test-harness";
import { generatePkcs8Pem } from "./test-keys";
import { migrateDatabase } from "../migrations";
import { createDb } from "../db";
import { signAscToken, syncAppStoreConnect } from "./appstoreconnect";

/* ------------------------------ Apple API mock ------------------------------ */

const APP_ID = "123456789";
const TODAY = new Date();
const iso = (offsetDays: number) =>
	new Date(TODAY.getTime() - offsetDays * 86400_000).toISOString().slice(0, 10);
const apple = (offsetDays: number) => {
	const d = new Date(TODAY.getTime() - offsetDays * 86400_000);
	return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

// Two sale days in US with a price change (0.99 → 2.99), one IAP row, one
// constant-price country, plus rows for another app that must be filtered.
const salesTsv = () => {
	const row = (
		day: number,
		country: string,
		units: number,
		perUnit: string,
		ext: string,
		price: string,
		type = "1",
		app = APP_ID,
	) =>
		[
			"RevKlik",
			"US",
			"klikapa01",
			"Y",
			perUnit,
			apple(day),
			apple(day),
			"USD",
			country,
			"USD",
			String(units),
			ext,
			price,
			type,
			app,
			"klikapa01",
		].join("\t");
	return [
		"Provider\tProvider Country\tSKU\tDesignated SKU Supported\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tUnits\tDeveloper Proceeds Extended\tCustomer Price\tProduct Type Identifier\tApple Identifier\tVendor Identifier",
		row(1, "US", 1, "0.70", "0.70", "2.99"),
		row(2, "US", 1, "0.70", "0.70", "0.99"),
		row(2, "US", 3, "0.35", "1.05", "1.99", "F"),
		row(2, "DE", 1, "0.70", "0.70", "1.09"),
		row(2, "US", 9, "0.70", "6.30", "0.99", "1", "987654321"),
	].join("\n");
};

const engagementCsv = () =>
	[
		"Date,App,App Name,Impressions,Page Views,Downloads,Proceeds,Paying Users",
		`${apple(1)},${APP_ID},KlikApa,100,50,1,"USD 12,345",4`,
	].join("\n");

/** Install a mock Apple API + local file server; returns captured requests. */
function mockApple() {
	const seen: { url: string; auth: string }[] = [];
	const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
		if (url.includes("appstoreconnect.apple.com")) {
			seen.push({ url, auth });
			const path = url.split("appstoreconnect.apple.com")[1];
			if (path.startsWith("/v1/salesReports")) {
				return new Response(salesTsv(), { status: 200 });
			}
			if (
				path === "/v1/apps/123456789/analyticsReportRequests" &&
				(!init?.method || init.method === "GET")
			) {
				return Response.json({ data: [] });
			}
			if (path === "/v1/analyticsReportRequests" && init?.method === "POST") {
				return Response.json({ data: { id: "req1" } });
			}
			if (path.startsWith("/v1/analyticsReportRequests/req1/reports")) {
				return Response.json({ data: [{ id: "rep1" }] });
			}
			if (path === "/v1/analyticsReports/rep1/instances") {
				return Response.json({ data: [{ id: "inst1", attributes: { granularity: "DAILY" } }] });
			}
			if (path === "/v1/analyticsReportInstances/inst1/segments") {
				return Response.json({
					data: [{ id: "seg1", attributes: { url: "http://local/engagement.csv" } }],
				});
			}
			return new Response("not found", { status: 404 });
		}
		if (url === "http://local/engagement.csv") {
			return new Response(engagementCsv(), { status: 200 });
		}
		return new Response("unexpected fetch", { status: 500 });
	};
	const original = globalThis.fetch;
	globalThis.fetch = impl as typeof fetch;
	return {
		requests: seen,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

/* --------------------------------- the test --------------------------------- */

describe("syncAppStoreConnect", () => {
	it("syncs sales reports, derives price-change annotations, layers engagement metrics — idempotently", async () => {
		const d1 = makeD1(new Database(":memory:"));
		await migrateDatabase(d1 as unknown as D1Database);
		const db = createDb(d1 as unknown as D1Database);
		await seedSiteWithSessionKey(d1 as unknown as D1Like);

		const mock = mockApple();
		try {
			const keyPair = (await crypto.subtle.generateKey(
				{ name: "ECDSA", namedCurve: "P-256" },
				true,
				["sign", "verify"],
			)) as CryptoKeyPair;
			const pem = await generatePkcs8Pem(keyPair.privateKey);
			const integration = {
				id: "i1",
				site_id: "s1",
				user_id: "u1",
				config: JSON.stringify({
					issuer_id: "iss-1",
					key_id: "kid-1",
					private_key: pem,
					app_id: APP_ID,
					vendor_number: "v123",
				}),
				last_sync: null,
			};

			const result = await syncAppStoreConnect(db, integration, { days: 3 });
			expect(result.days_synced).toBe(3);

			// Metrics: yesterday (day 1) 1 unit @2.99 tier; day 2: 1 unit @0.99 + IAP.
			const metrics = await db.selectFrom("asc_daily_metrics").selectAll().execute();
			expect(metrics).toHaveLength(2);
			const day1 = metrics.find((m) => m.date === iso(1));
			expect(day1?.units).toBe(1);
			expect(day1?.proceeds).toBeCloseTo(0.7);
			const day2 = metrics.find((m) => m.date === iso(2));
			expect(day2?.units).toBe(2);
			expect(day2?.proceeds).toBeCloseTo(1.4);
			expect(day2?.iap_units).toBe(3);
			// Engagement layered onto day 1 without touching sales figures.
			expect(day1?.impressions).toBe(100);
			expect(day1?.paying_users).toBe(4);

			// Country rows carry the charged tier prices.
			const countries = await db.selectFrom("asc_daily_country").selectAll().execute();
			const usDay2 = countries.find((c) => c.date === iso(2) && c.country === "US");
			expect(usDay2?.customer_price).toBeCloseTo(0.99);
			const deDay2 = countries.find((c) => c.date === iso(2) && c.country === "DE");
			expect(deDay2?.customer_price).toBeCloseTo(1.09);

			// The 0.99 → 2.99 US transition (day 2 → day 1) becomes an annotation…
			const annotations = await db.selectFrom("annotations").selectAll().execute();
			expect(annotations).toHaveLength(1);
			expect(annotations[0].text).toBe(`App Store price change — US: 0.99 → 2.99 USD`);
			expect(annotations[0].date).toBe(iso(1));

			// …and a second sync must not duplicate it (idempotent upserts).
			const result2 = await syncAppStoreConnect(db, integration, { days: 3 });
			const annotations2 = await db.selectFrom("annotations").selectAll().execute();
			expect(annotations2).toHaveLength(1);
			const metrics2 = await db.selectFrom("asc_daily_metrics").selectAll().execute();
			expect(metrics2).toHaveLength(2);
			expect(result2.days_synced).toBe(3);

			// JWT reaching Apple is ES256 with our key id — verify the signature.
			const jwt = mock.requests[0].auth.replace("Bearer ", "");
			const [h, p, s] = jwt.split(".");
			expect(JSON.parse(atob(h))).toEqual({ alg: "ES256", kid: "kid-1", typ: "JWT" });
			expect(JSON.parse(atob(p))).toMatchObject({ iss: "iss-1", aud: "appstoreconnect-v1" });
			const verifyKey = await crypto.subtle.importKey(
				"jwk",
				await crypto.subtle.exportKey("jwk", keyPair.publicKey),
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["verify"],
			);
			const sigB64 = s.replace(/-/g, "+").replace(/_/g, "/");
			const sig = Uint8Array.from(atob(sigB64), (ch) => ch.charCodeAt(0));
			// The intercepted token was signed with the same key → must verify.
			expect(
				await crypto.subtle.verify(
					{ name: "ECDSA", hash: "SHA-256" },
					verifyKey,
					sig,
					new TextEncoder().encode(`${h}.${p}`),
				),
			).toBe(true);
			// The token our lib signs with the SAME key must verify.
			const own = await signAscToken(
				{ issuer_id: "iss-1", key_id: "kid-1", private_key: pem },
				Date.now(),
			);
			const [h2, p2, s2] = own.split(".");
			const sig2 = Uint8Array.from(atob(s2.replace(/-/g, "+").replace(/_/g, "/")), (ch) =>
				ch.charCodeAt(0),
			);
			expect(
				await crypto.subtle.verify(
					{ name: "ECDSA", hash: "SHA-256" },
					verifyKey,
					sig2,
					new TextEncoder().encode(`${h2}.${p2}`),
				),
			).toBe(true);
		} finally {
			mock.restore();
		}
	});
});

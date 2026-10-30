import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { sql } from "kysely";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import { clearStoredRatesCache, revenueSql } from "./fx";
import { recordServerEvent } from "./server-events";
import { makeD1 } from "./test-harness";

async function fresh() {
	const raw = new Database(":memory:");
	const d1 = makeD1(raw) as unknown as D1Database;
	await migrateDatabase(d1);
	raw.exec(
		"INSERT INTO users (id, email, password_hash, name) VALUES ('u','u@x.id','x','u'); INSERT INTO sites (id, user_id, name, domain) VALUES ('s','u','s','s.id')",
	);
	return { raw, db: createDb(d1) };
}

const SITE = { id: "s", revenue_currency: "IDR" };
const sale = (externalId: string, over: Record<string, unknown> = {}) => ({
	siteId: "s",
	name: "payment",
	revenue: 100_000,
	currency: "IDR",
	externalId,
	source: "midtrans",
	...over,
});

beforeEach(() => clearStoredRatesCache());

describe("FX stamped at booking", () => {
	it("stores the rate and its date; an unknown currency keeps its native amount, flagged, never 1:1 USD", async () => {
		const { raw, db } = await fresh();
		await recordServerEvent(db, SITE, sale("a"));
		await recordServerEvent(db, SITE, sale("b", { revenue: 5, currency: "XYZ" }));
		const rows = raw
			.query(
				"SELECT external_id, revenue, currency, fx_rate, fx_date, fx_status FROM events ORDER BY external_id",
			)
			.all() as Array<{
			external_id: string;
			revenue: number;
			currency: string;
			fx_rate: number | null;
			fx_date: string | null;
			fx_status: string;
		}>;
		expect(rows[0]).toMatchObject({ currency: "IDR", fx_rate: 16_000, fx_status: "fallback" });
		expect(rows[0]?.fx_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(rows[1]).toEqual({
			external_id: "b",
			revenue: 5,
			currency: "XYZ",
			fx_rate: null,
			fx_date: null,
			fx_status: "unconverted",
		});
	});

	it("converted totals use the booked rate, not today's, and leave unconverted rows out", async () => {
		const { raw, db } = await fresh();
		await recordServerEvent(db, SITE, sale("a", { revenue: 150_000 }));
		await recordServerEvent(db, SITE, sale("b", { revenue: 5, currency: "XYZ" }));
		// The rate the sale was booked at was 15,000; today's table says 20,000.
		raw.exec("UPDATE events SET fx_rate = 15000 WHERE external_id = 'a'");
		const total = async (currency: string) => {
			const r = await sql<{
				total: number;
			}>`SELECT COALESCE(SUM(${revenueSql({ currency, rates: { USD: 1, IDR: 20_000 } })}), 0) AS total FROM events`.execute(
				db,
			);
			return r.rows[0]?.total;
		};
		expect(await total("USD")).toBeCloseTo(10, 6);
		expect(await total("IDR")).toBe(150_000);
	});
});

describe("adopting a browser-reported sale", () => {
	const browserSale = (raw: Database, id: string, visitor: string) =>
		raw
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, revenue, currency, payment_provider) VALUES (?,?,?,?,?,'conversion','/thanks',100000,'IDR','midtrans')",
			)
			.run(id, "s", `ses-${id}`, visitor, new Date().toISOString());

	it("does not guess between two buyers when the order names none", async () => {
		const { raw, db } = await fresh();
		browserSale(raw, "c1", "v1");
		browserSale(raw, "c2", "v2");
		const result = await recordServerEvent(db, SITE, sale("order-1"));
		expect(result.adopted).toBeUndefined();
		expect(
			(
				raw.query("SELECT COUNT(*) AS n FROM events WHERE event_type = 'conversion'").get() as {
					n: number;
				}
			).n,
		).toBe(3);
	});

	it("adopts the only candidate, and the named buyer's row among several", async () => {
		const { raw, db } = await fresh();
		browserSale(raw, "c1", "v1");
		expect((await recordServerEvent(db, SITE, sale("order-1"))).adopted).toBe(true);
		browserSale(raw, "c2", "v2");
		browserSale(raw, "c3", "v3");
		const named = await recordServerEvent(db, SITE, sale("order-2", { visitorId: "v3" }));
		expect(named).toMatchObject({ adopted: true, eventId: "c3" });
	});
});

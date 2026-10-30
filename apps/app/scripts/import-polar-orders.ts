#!/usr/bin/env bun
/**
 * Books real Polar orders (a JSON export of the dashboard's paid orders) for one
 * site through the worker's own import path (`processPolarOrder`), then reconciles
 * the browser-reported conversions against them (lib/revenue-backfill.ts).
 *
 *   bun scripts/import-polar-orders.ts --orders=/tmp/polar-orders-2026.json --site=<site_id>
 *                                      [--year=2026] [--through=<ISO>] [--out=<file.sql>] [--apply]
 *
 * It copies the site's revenue rows from remote D1 (SELECTs only) into an
 * in-memory migrated database, runs the import and the reconciliation there, and
 * diffs the result into SQL: new order rows, browser rows adopted by their order
 * (order id, paid amount, reported net), refunds as negative `<id>:refund` rows,
 * and browser rows excluded as 'duplicate' (matched to an order by time) or
 * 'unconfirmed' (inside the period the orders cover, no order). Nothing is deleted.
 *
 * Without --apply the SQL is only written to --out. With --apply it runs against
 * remote D1; every statement is guarded by the old value (INSERT OR IGNORE on the
 * unique order id), so running the file twice changes nothing. Needs schema v24
 * (events.excluded_reason): deploy first.
 *
 * Order fields (cents): total, sub, disc, net (= total - tax, the revenue booked),
 * tax, fee (Polar's platform fee; proceeds = net - fee), refunded, status, cur, at,
 * product, country, id.
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "../src/worker/db";
import type { FeeRule } from "../src/worker/lib/fees";
import { usdRates, type FxRates } from "../src/worker/lib/fx";
import { processPolarOrder, type PolarOrder } from "../src/worker/lib/polar";
import {
	patchSql,
	planRevenueBackfill,
	totalsByRail,
	type BackfillContext,
	type BackfillEvent,
	type RailTotals,
} from "../src/worker/lib/revenue-backfill";
import { makeD1 } from "../src/worker/lib/test-harness";
import { migrateDatabase } from "../src/worker/migrations";
import { d1Execute, d1Select, type D1Target } from "./d1";

interface ExportedOrder {
	id: string;
	at: string;
	cur: string;
	total: number;
	net: number;
	tax: number;
	fee: number;
	refunded: number;
	status: string;
	product?: string;
	country?: string;
	/** When the refund happened (Polar order.modified_at or the refund's created_at); the refund is dated at the order without it. */
	refunded_at?: string;
}

type Row = Record<string, unknown>;

const args = new Map(
	process.argv.slice(2).map((a) => {
		const [key, value] = a.replace(/^--/, "").split("=");
		return [key as string, value ?? "true"] as const;
	}),
);
const ordersFile = args.get("orders");
const siteId = args.get("site");
const year = args.get("year") ?? String(new Date().getUTCFullYear());
const apply = args.has("apply");
const outFile = args.get("out") ?? `polar-orders-${new Date().toISOString().slice(0, 10)}.sql`;
const target: D1Target = "--remote";
if (!ordersFile || !siteId || !/^[A-Za-z0-9_-]+$/.test(siteId)) {
	throw new Error("usage: --orders=<file.json> --site=<site_id> [--year=] [--out=] [--apply]");
}
const remote = <T>(sql: string): T[] => d1Select<T>(target, sql);

const orders = (JSON.parse(readFileSync(ordersFile, "utf8")) as ExportedOrder[]).sort((a, b) =>
	a.at < b.at ? -1 : 1,
);

// 1. A migrated in-memory copy of the site's revenue rows.
const sqlite = new Database(":memory:");
const d1 = makeD1(sqlite) as unknown as D1Database;
await migrateDatabase(d1);

function copy(into: Database, table: string, rows: Row[]): void {
	const local = new Set(
		(into.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
	);
	for (const row of rows) {
		const cols = Object.keys(row).filter((c) => local.has(c));
		into
			.prepare(
				`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
			)
			.run(...cols.map((c) => row[c] as never));
	}
}

const site = remote<Row>(`SELECT * FROM sites WHERE id = '${siteId}'`);
if (site.length !== 1) throw new Error(`site ${siteId} not found`);
const remoteRows: Array<[string, Row[]]> = [
	["sites", site],
	["fee_rules", remote<Row>("SELECT * FROM fee_rules")],
	["fx_rates", remote<Row>("SELECT * FROM fx_rates")],
	[
		"events",
		remote<Row>(
			`SELECT * FROM events WHERE site_id = '${siteId}' AND revenue IS NOT NULL AND revenue != 0`,
		),
	],
	[
		"visitor_profiles",
		remote<Row>(
			`SELECT * FROM visitor_profiles WHERE site_id = '${siteId}' AND visitor_id IN (SELECT DISTINCT visitor_id FROM events WHERE site_id = '${siteId}' AND revenue != 0)`,
		),
	],
];
for (const [table, rows] of remoteRows) copy(sqlite, table, rows);

const dumpOf = (from: Database, table: string): Map<string, Row> =>
	new Map((from.query(`SELECT * FROM ${table}`).all() as Row[]).map((r) => [String(r.id), r]));
const dump = (table: string): Map<string, Row> => dumpOf(sqlite, table);
const before = { events: dump("events"), visitor_profiles: dump("visitor_profiles") };

const loadEvents = (): BackfillEvent[] =>
	sqlite
		.query(
			`SELECT e.id, e.site_id, s.user_id AS owner_id, e.visitor_id, e.timestamp, e.event_type, e.path, e.revenue, e.currency, e.rail, e.product, e.payment_provider, e.net_revenue, e.net_source, e.external_id, e.props, e.excluded_reason
			 FROM events e JOIN sites s ON s.id = e.site_id WHERE e.revenue != 0 AND e.is_bot = 0`,
		)
		.all() as BackfillEvent[];

const rates: FxRates = {
	...usdRates(),
	...Object.fromEntries(
		(
			sqlite.query("SELECT currency, per_usd FROM fx_rates").all() as Array<{
				currency: string;
				per_usd: number;
			}>
		).map((r) => [r.currency.toUpperCase(), r.per_usd]),
	),
};
const rules = new Map<string, FeeRule>();
for (const r of sqlite.query("SELECT * FROM fee_rules").all() as Array<
	FeeRule & { user_id: string }
>) {
	rules.set(`${r.user_id}\u0000${r.rail}`, r);
}
// The orders vouch for the period up to --through (default: the newest order in the file):
// a browser sale after it may simply not be in the export yet, so it stays counted.
const through = args.get("through")
	? Date.parse(args.get("through") as string)
	: Date.parse(orders.at(-1)?.at ?? "");
if (!Number.isFinite(through)) throw new Error("--through must be an ISO time");
const ctx: BackfillContext = {
	rates,
	rules,
	confirmedThrough: new Map([[`${siteId}\u0000polar`, through]]),
};
const eventsBefore = loadEvents();

// 2. The orders, through the import path.
const results: Record<string, number> = {};
const db = createDb(d1);
for (const o of orders) {
	// A row booked from an older import carries a different amount: the order's net is the revenue.
	const existing = sqlite
		.query("SELECT id, visitor_id, revenue FROM events WHERE site_id = ? AND external_id = ?")
		.get(siteId, o.id) as { id: string; visitor_id: string; revenue: number } | null;
	const revenue = o.net / 100;
	if (existing && Math.abs(existing.revenue - revenue) > 1e-9) {
		sqlite.prepare("UPDATE events SET revenue = ? WHERE id = ?").run(revenue, existing.id);
		sqlite
			.prepare(
				"UPDATE visitor_profiles SET total_revenue = MAX(0, total_revenue + ?) WHERE site_id = ? AND visitor_id = ?",
			)
			.run(revenue - existing.revenue, siteId, existing.visitor_id);
	}
	const order: PolarOrder = {
		id: o.id,
		status: o.status,
		total_amount: o.total,
		net_amount: o.net,
		refunded_amount: o.refunded,
		platform_fee_amount: o.fee,
		platform_fee_currency: o.cur,
		currency: o.cur,
		created_at: o.at,
		...(o.refunded_at ? { refunded_at: o.refunded_at } : {}),
		billing_reason: "purchase",
		product: { name: o.product ?? null },
		billing_address: { country: o.country ?? null },
	};
	const outcome = await processPolarOrder(db, order, siteId);
	results[outcome] = (results[outcome] ?? 0) + 1;
}

// 3. Reconcile browser rows against the orders.
const plan = planRevenueBackfill(loadEvents(), ctx);
for (const patch of plan.patches) for (const statement of patchSql(patch)) sqlite.exec(statement);
const eventsAfter = loadEvents();

// 4. Diff into guarded SQL.
const lit = (v: unknown): string => {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return String(v);
	return `'${String(v).replaceAll("'", "''")}'`;
};
const statements: string[] = [];
function diff(table: string, key: string[], then: Map<string, Row>) {
	for (const [id, now] of dump(table)) {
		const was = then.get(id);
		const cols = Object.keys(now);
		if (!was) {
			const kept = cols.filter((c) => now[c] !== null);
			statements.push(
				`INSERT OR IGNORE INTO ${table} (${kept.join(", ")}) VALUES (${kept.map((c) => lit(now[c])).join(", ")})`,
			);
			continue;
		}
		const changed = cols.filter((c) => now[c] !== was[c]);
		if (changed.length === 0) continue;
		const where = key.map((k) => `${k} = ${lit(now[k])}`).join(" AND ");
		const guard = changed.map((c) => `${c} IS ${lit(was[c])}`).join(" AND ");
		statements.push(
			`UPDATE ${table} SET ${changed.map((c) => `${c} = ${lit(now[c])}`).join(", ")} WHERE ${where} AND ${guard}`,
		);
	}
}
diff("events", ["id"], before.events);
diff("visitor_profiles", ["id"], before.visitor_profiles);
writeFileSync(outFile, `${statements.map((s) => `${s};`).join("\n")}\n`);

// The file must reproduce the dry-run state from the remote rows, and a second run must change nothing.
const replica = new Database(":memory:");
await migrateDatabase(makeD1(replica) as unknown as D1Database);
for (const [table, rows] of remoteRows) copy(replica, table, rows);
const state = (from: Database) =>
	JSON.stringify([...dumpOf(from, "events")].concat([...dumpOf(from, "visitor_profiles")]).sort());
for (const statement of statements) replica.exec(statement);
const once = state(replica);
for (const statement of statements) replica.exec(statement);
if (once !== state(sqlite)) throw new Error("the SQL does not reproduce the dry-run state");
if (state(replica) !== once) throw new Error("the SQL is not idempotent");
console.log(
	"verified: the SQL reproduces the dry-run state on a fresh copy, and a second run changes nothing",
);

// 5. Report.
const rowsAfter = dump("events");
const orderIds = new Set(orders.map((o) => o.id));
const adopted = [...rowsAfter.values()].filter(
	(r) =>
		before.events.has(String(r.id)) &&
		orderIds.has(String(r.external_id)) &&
		before.events.get(String(r.id))?.external_id === null,
);
const inserted = [...rowsAfter.values()].filter((r) => !before.events.has(String(r.id)));
const excluded = (reason: string) =>
	[...rowsAfter.values()].filter(
		(r) =>
			r.excluded_reason === reason && before.events.get(String(r.id))?.excluded_reason === null,
	);
console.log(`orders ${orders.length}: ${JSON.stringify(results)}`);
console.log(
	`booked as new rows ${inserted.length}; browser rows adopted by their order ${adopted.length}; excluded as duplicate ${excluded("duplicate").length}, unconfirmed ${excluded("unconfirmed").length}`,
);
for (const r of excluded("unconfirmed")) {
	console.log(
		`  unconfirmed ${String(r.timestamp).slice(0, 19)} ${r.revenue} ${String(r.visitor_id).slice(0, 8)}`,
	);
}

const inYear = (events: BackfillEvent[]) => events.filter((e) => e.timestamp.startsWith(year));
const polarRails = new Set(["polar", "polar_import"]);
const fmt = (n: number, d = 0) =>
	n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
for (const cur of ["USD", "IDR"]) {
	const digits = cur === "USD" ? 2 : 0;
	const sum = (rows: RailTotals[]) =>
		rows
			.filter((r) => polarRails.has(r.rail))
			.reduce(
				(a, r) => ({ sales: a.sales + r.sales, gross: a.gross + r.gross, net: a.net + r.net }),
				{ sales: 0, gross: 0, net: 0 },
			);
	const b = sum(totalsByRail(inYear(eventsBefore), ctx, cur, "legacy"));
	const a = sum(totalsByRail(inYear(eventsAfter), ctx, cur, "backfilled"));
	console.log(
		`Polar ${year} ${cur}: before ${b.sales} sales gross ${fmt(b.gross, digits)} net ${fmt(b.net, digits)} | after ${a.sales} sales gross ${fmt(a.gross, digits)} net ${fmt(a.net, digits)}`,
	);
}
const paid = orders.reduce((a, o) => a + o.net, 0) / 100;
const fees = orders.reduce((a, o) => a + o.fee, 0) / 100;
const refunded = orders.reduce((a, o) => a + o.refunded, 0) / 100;
console.log(
	`Polar export (USD): revenue net of tax ${fmt(paid, 2)}, refunds ${fmt(refunded, 2)}, Polar fees ${fmt(fees, 2)}, proceeds before refunds ${fmt(paid - fees, 2)}`,
);
console.log(`${statements.length} statements -> ${outFile}`);

if (!apply) {
	console.log("Dry run: nothing written to the database. Re-run with --apply to execute the file.");
} else {
	const columns = d1Select<{ name: string }>(target, "PRAGMA table_info(events)").map(
		(c) => c.name,
	);
	if (!columns.includes("excluded_reason")) {
		throw new Error("events.excluded_reason is missing: deploy schema v24 first, then --apply.");
	}
	d1Execute(target, "--file", outFile);
	console.log("Applied.");
}

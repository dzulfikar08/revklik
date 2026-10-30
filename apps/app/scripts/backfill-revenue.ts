#!/usr/bin/env bun
/**
 * Makes stored revenue rows canonical: rail, product, net after fees, test sales
 * and double-booked sales (rules in src/worker/lib/revenue-backfill.ts).
 *
 *   bun scripts/backfill-revenue.ts [--remote|--local] [--site=<id>] [--year=2026]
 *                                   [--currency=IDR] [--out=<file.sql>] [--apply]
 *
 * Without --apply it only READS (SELECTs through `wrangler d1 execute`), prints the
 * per-rail before/after totals and writes the SQL it would run to --out. With
 * --apply it runs that file. Every statement is guarded by the column's old state,
 * so running it twice changes nothing. Needs the events.excluded_reason column
 * (schema v24): deploy first, then --apply.
 */
import { writeFileSync } from "node:fs";
import { usdRates, type FxRates } from "../src/worker/lib/fx";
import type { FeeRule } from "../src/worker/lib/fees";
import {
	patchSql,
	planRevenueBackfill,
	totalsByRail,
	type BackfillContext,
	type BackfillEvent,
} from "../src/worker/lib/revenue-backfill";

const DATABASE = "klikapa-db";
const PAGE = 1000;

const args = new Map(
	process.argv.slice(2).map((a) => {
		const [key, value] = a.replace(/^--/, "").split("=");
		return [key as string, value ?? "true"] as const;
	}),
);
const target = args.has("local") ? "--local" : "--remote";
const siteId = args.get("site");
const year = args.get("year") ?? String(new Date().getUTCFullYear());
const currency = (args.get("currency") ?? "IDR").toUpperCase();
const apply = args.has("apply");
const outFile = args.get("out") ?? `revenue-backfill-${new Date().toISOString().slice(0, 10)}.sql`;

if (siteId && !/^[A-Za-z0-9_-]+$/.test(siteId)) throw new Error("--site must be a site id");
if (!/^\d{4}$/.test(year)) throw new Error("--year must be YYYY");

function wrangler(...extra: string[]): string {
	const proc = Bun.spawnSync(["npx", "wrangler", "d1", "execute", DATABASE, target, ...extra], {
		stdin: "inherit",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error(`wrangler failed: ${proc.stderr.toString() || proc.stdout.toString()}`);
	}
	return proc.stdout.toString();
}

function select<T>(sql: string): T[] {
	const parsed = JSON.parse(wrangler("--json", "--command", sql)) as Array<{ results: T[] }>;
	return parsed[0]?.results ?? [];
}

const columns = select<{ name: string }>("PRAGMA table_info(events)").map((c) => c.name);
const hasExcluded = columns.includes("excluded_reason");

const events: BackfillEvent[] = [];
let lastRowId = 0;
for (;;) {
	const page = select<BackfillEvent & { rid: number }>(
		`SELECT e.rowid AS rid, e.id, e.site_id, s.user_id AS owner_id, e.visitor_id, e.timestamp, e.event_type, e.path, e.revenue, e.currency, e.rail, e.product, e.payment_provider, e.net_revenue, e.net_source, e.external_id, e.props, ${hasExcluded ? "e.excluded_reason" : "NULL AS excluded_reason"}
		 FROM events e JOIN sites s ON s.id = e.site_id
		 WHERE e.revenue IS NOT NULL AND e.revenue != 0 AND e.is_bot = 0 AND e.rowid > ${lastRowId}
		 ${siteId ? `AND e.site_id = '${siteId}'` : ""}
		 ORDER BY e.rowid LIMIT ${PAGE}`,
	);
	for (const row of page) events.push(row);
	if (page.length < PAGE) break;
	lastRowId = (page.at(-1) as { rid: number }).rid;
}

const storedRates = select<{ currency: string; per_usd: number }>(
	"SELECT currency, per_usd FROM fx_rates",
);
const rates: FxRates = {
	...usdRates(),
	...Object.fromEntries(storedRates.map((r) => [r.currency.toUpperCase(), r.per_usd])),
};
const rules = new Map<string, FeeRule>();
for (const r of select<FeeRule & { user_id: string }>(
	"SELECT user_id, rail, percent_bps, fixed_amount, fixed_currency FROM fee_rules",
)) {
	rules.set(`${r.user_id}\u0000${r.rail}`, r);
}
const ctx: BackfillContext = { rates, rules };

const plan = planRevenueBackfill(events, ctx);
const statements = plan.patches.flatMap(patchSql);
writeFileSync(outFile, `${statements.map((s) => `${s};`).join("\n")}\n`);

const inYear = events.filter((e) => e.timestamp.startsWith(year));
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
for (const mode of ["legacy", "backfilled"] as const) {
	console.log(
		`\n${mode === "legacy" ? "BEFORE (as the portfolio reads it today)" : "AFTER backfill"} - ${year}, ${currency}`,
	);
	let gross = 0;
	let net = 0;
	for (const r of totalsByRail(inYear, ctx, currency, mode)) {
		console.log(
			`  ${r.rail.padEnd(24)} sales ${String(r.sales).padStart(4)}  gross ${fmt(r.gross).padStart(14)}  net ${fmt(r.net).padStart(14)}`,
		);
		gross += r.gross;
		net += r.net;
	}
	console.log(
		`  ${"TOTAL".padEnd(24)} ${" ".repeat(10)}  gross ${fmt(gross).padStart(14)}  net ${fmt(net).padStart(14)}`,
	);
}
console.log(
	`\n${events.length} revenue rows read; patches for ${plan.patches.length} rows (rail ${plan.counts.rail}, product ${plan.counts.product}, net ${plan.counts.net}, test ${plan.counts.test}, duplicate ${plan.counts.duplicate}); ${statements.length} statements -> ${outFile}`,
);

if (!apply) {
	console.log("Dry run: nothing written to the database. Re-run with --apply to execute the file.");
} else if (!hasExcluded) {
	throw new Error(
		"events.excluded_reason is missing: deploy schema v24 first, then run with --apply.",
	);
} else if (statements.length === 0) {
	console.log("Nothing to apply.");
} else {
	wrangler("--file", outFile);
	console.log("Applied.");
}

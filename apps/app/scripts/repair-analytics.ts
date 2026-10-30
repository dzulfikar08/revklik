#!/usr/bin/env bun
/**
 * One-off repairs for analytics rows written by two bugs (rules and SQL in
 * src/worker/lib/analytics-repair.ts):
 *
 *   ods-timestamps   OneDollarStats imports with a malformed timestamp
 *   total-sessions   visitor_profiles.total_sessions inflated ~5x
 *
 *   bun scripts/repair-analytics.ts [--remote|--local] [--only=ods-timestamps,total-sessions]
 *                                   [--out=<file.sql>] [--apply]
 *
 * Without --apply it only READS: it prints how many rows each repair would
 * touch plus a few before/after samples, and writes the SQL it would run to
 * --out. With --apply it runs that file. Running it twice changes nothing.
 */
import { writeFileSync } from "node:fs";
import { d1Execute, d1Select, type D1Target } from "./d1";
import { ANALYTICS_REPAIRS } from "../src/worker/lib/analytics-repair";

const args = new Map(
	process.argv.slice(2).map((a) => {
		const [key, value] = a.replace(/^--/, "").split("=");
		return [key as string, value ?? "true"] as const;
	}),
);
const target: D1Target = args.has("local") ? "--local" : "--remote";
const apply = args.has("apply");
const outFile = args.get("out") ?? `analytics-repair-${new Date().toISOString().slice(0, 10)}.sql`;
const only = args.get("only")?.split(",");
const unknown = only?.filter((n) => !ANALYTICS_REPAIRS.some((r) => r.name === n)) ?? [];
if (unknown.length > 0) throw new Error(`unknown repair: ${unknown.join(", ")}`);
const chosen = ANALYTICS_REPAIRS.filter((r) => !only || only.includes(r.name));

const statements: string[] = [];
for (const repair of chosen) {
	const [count] = d1Select<{ n: number }>(
		target,
		`SELECT COUNT(*) AS n FROM ${repair.table} WHERE ${repair.where}`,
	);
	const rows = Number(count?.n ?? 0);
	console.log(`${repair.name}: ${rows} row(s) - ${repair.description}`);
	if (rows === 0) continue;
	for (const row of d1Select<Record<string, unknown>>(
		target,
		`SELECT ${repair.sample} FROM ${repair.table} WHERE ${repair.where} LIMIT 5`,
	)) {
		console.log(`  ${JSON.stringify(row)}`);
	}
	statements.push(repair.update);
}

if (statements.length === 0) {
	console.log("Nothing to repair.");
} else {
	writeFileSync(outFile, `${statements.join("\n")}\n`);
	console.log(`SQL written to ${outFile}`);
	if (apply) {
		d1Execute(target, "--file", outFile);
		console.log("Applied.");
	} else {
		console.log("Dry run: nothing changed. Re-run with --apply to execute the file.");
	}
}

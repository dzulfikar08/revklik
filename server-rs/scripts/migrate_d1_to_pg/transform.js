#!/usr/bin/env node
// Transform a Cloudflare D1 (`wrangler d1 export`) SQL dump into Postgres-loadable
// COPY/INSERT data. Run after `wrangler d1 export --remote --database=<name> > dump.sql`.
//
// Per-row transforms:
//   - timestamps (TEXT ISO) -> normalized UTC `Z` ISO8601 (suitable for timestamptz)
//   - boolean columns: 0/1 -> true/false
//   - JSON TEXT columns -> validated jsonb (drops invalid rows with a warning)
//   - TEXT IDs kept verbatim (visitor_id/session_id carry non-uuid prefixes)
//
// Output: stdout emits Postgres INSERT statements against the schema in migrations/0001_init.sql.
// The hypertable/cagg/index migrations (0002-0005) must NOT have run yet on the target DB when
// loading this output — run them AFTER, then refresh caggs. See MIGRATION.md.
//
// Usage:
//   node transform.js < dump.sql > load.sql
//   psql "$DATABASE_URL" -f load.sql
//   # then: sqlx migrate (runs 0002-0005) OR apply 0002-0005 manually, then refresh caggs.

const readline = require("node:readline");

// Boolean columns per table (INTEGER 0/1 -> boolean).
const BOOL_COLS = {
	sites: ["public_dashboard"],
	sessions: ["is_bounce"],
	integrations: ["enabled"],
	subscriptions: ["cancel_at_period_end"],
	payment_providers: ["enabled"],
	email_reports: ["enabled"],
};

// JSON TEXT columns to validate.
const JSON_COLS = new Set([
	"props",
	"tags",
	"config",
	"payload",
	"items",
	"buyer_info",
	"filters",
	"scopes",
	"click_grid",
	"scroll_depths",
	"events",
	"data_refs",
]);

// Columns that are timestamps (TEXT ISO -> timestamptz).
const TS_COLS = new Set([
	"timestamp",
	"started_at",
	"ended_at",
	"first_seen",
	"last_seen",
	"created_at",
	"updated_at",
	"fetched_at",
	"processed_at",
	"last_used_at",
	"expires_at",
	"invited_at",
	"accepted_at",
	"last_sync",
	"last_sent",
	"current_period_start",
	"current_period_end",
	"ordered_at",
	"synced_at",
]);

const stats = { rows: 0, dropped_invalid_json: 0, tables: {} };

function normTs(v) {
	if (v == null) return null;
	// D1 stores ISO strings; ensure trailing Z for UTC.
	let s = String(v);
	if (s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s)) return s;
	// Replace trailing space with T if "YYYY-MM-DD HH:MM:SS"
	s = s.replace(" ", "T");
	return `${s}Z`;
}

function toBool(v) {
	if (v === 1 || v === "1" || v === true || v === "true") return "true";
	return "false";
}

// Parse a SQL literal value from D1 export (handles NULL, numbers, 'quoted', X'blob').
function parseLiteral(raw) {
	const s = raw.trim();
	if (s.toUpperCase() === "NULL") return { val: null, ok: true };
	if (s.startsWith("'") && s.endsWith("'")) {
		// quoted string; unescape '' -> '
		return { val: s.slice(1, -1).replace(/''/g, "'"), ok: true };
	}
	if (s.startsWith("X'")) {
		// hex blob — return as decoded text-ish; rare. Pass through.
		return { val: null, ok: true };
	}
	// number
	return { val: s, ok: true };
}

function sqlEscape(v) {
	if (v === null || v === undefined) return "NULL";
	return `'${String(v).replace(/'/g, "''")}'`;
}

const rl = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});
const out = process.stdout;

out.write("BEGIN;\n");

rl.on("line", (line) => {
	const m = line.match(
		/^INSERT INTO "(\w+)" \(([^)]+)\) VALUES \((.+)\);?\s*$/,
	);
	if (!m) return;
	const [, table, colsCsv, valsCsv] = m;
	const cols = colsCsv.split(",").map((c) => c.trim().replace(/"/g, ""));
	// Split values respecting quoted strings with embedded commas.
	const vals = [];
	let cur = "";
	let inQ = false;
	for (let i = 0; i < valsCsv.length; i++) {
		const ch = valsCsv[i];
		if (ch === "'") {
			if (inQ && valsCsv[i + 1] === "'") {
				cur += "''";
				i++;
				continue;
			}
			inQ = !inQ;
			cur += ch;
		} else if (ch === "," && !inQ) {
			vals.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	vals.push(cur);

	const bools = new Set(BOOL_COLS[table] || []);
	const outVals = [];
	for (let i = 0; i < cols.length; i++) {
		const col = cols[i];
		const { val, ok } = parseLiteral(vals[i] || "NULL");
		if (!ok) return;
		const v = val;
		if (v === null) {
			outVals.push("NULL");
			continue;
		}
		if (bools.has(col)) {
			outVals.push(toBool(v));
			continue;
		}
		if (TS_COLS.has(col)) {
			outVals.push(sqlEscape(normTs(v)));
			continue;
		}
		if (JSON_COLS.has(col)) {
			// validate; D1 may store 'null' or '{}'.
			try {
				if (v === "" || v == null) {
					outVals.push("NULL");
				} else {
					JSON.parse(v);
					outVals.push(sqlEscape(v));
				}
			} catch {
				stats.dropped_invalid_json++;
				process.stderr.write(
					`[warn] ${table}.${col} invalid JSON, setting NULL: ${String(v).slice(0, 60)}\n`,
				);
				outVals.push("NULL");
			}
			continue;
		}
		outVals.push(sqlEscape(v));
	}

	// Hypertable tables have composite PKs in 0001; plain INSERT is fine (ids unique enough).
	out.write(
		`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${outVals.join(",")});\n`,
	);
	stats.rows++;
	stats.tables[table] = (stats.tables[table] || 0) + 1;
});

rl.on("close", () => {
	out.write("COMMIT;\n");
	process.stderr.write(
		`\n[migrate] transformed ${stats.rows} rows across ${Object.keys(stats.tables).length} tables\n`,
	);
	process.stderr.write(
		`[migrate] invalid JSON values nulled: ${stats.dropped_invalid_json}\n`,
	);
	for (const [t, n] of Object.entries(stats.tables))
		process.stderr.write(`  ${t}: ${n}\n`);
});

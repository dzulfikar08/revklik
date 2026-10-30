#!/usr/bin/env bun
/**
 * Backup restore rehearsal. Two modes; neither touches production.
 *
 *   bun scripts/restore-drill.ts
 *       Self-contained: seeds a database, runs the real nightly backup against an
 *       in-memory R2, decrypts and restores it into an empty database and compares
 *       every row. Also proves a missing key, a wrong key, a corrupted file and a
 *       truncated file are all refused. Exit code 0 only when every check passes.
 *
 *   BACKUP_ENCRYPTION_KEY=<base64> bun scripts/restore-drill.ts --file <dump.sql.enc> [--sql-out <dump.sql>]
 *       Real dump: decrypt a file downloaded from R2, load it into a scratch SQLite,
 *       print integrity_check and per-table row counts. --sql-out also writes the
 *       decrypted SQL, ready for `wrangler d1 execute <db> --remote --file=<dump.sql>`.
 *
 * Full runbook: docs/backup-restore.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inspectDump, runRestoreDrill } from "../src/worker/lib/restore-drill";
import { decryptBackup, importBackupKey } from "../src/worker/lib/backup-crypto";

const args = process.argv.slice(2);
const flag = (name: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};

const file = flag("--file");
if (file) {
	const key = process.env.BACKUP_ENCRYPTION_KEY;
	const encrypted = new Uint8Array(readFileSync(file));
	const out = flag("--sql-out");
	if (out) {
		const sql = await decryptBackup(await importBackupKey(key), encrypted);
		writeFileSync(out, sql);
		console.log(`decrypted SQL written to ${out}`);
	}
	const report = await inspectDump(encrypted, key ?? "");
	console.log(`integrity_check: ${report.integrity}`);
	for (const [table, rows] of Object.entries(report.tables))
		console.log(`${table.padEnd(28)} ${rows}`);
	process.exit(report.integrity === "ok" ? 0 : 1);
}

const report = await runRestoreDrill();
for (const c of report.checks) {
	console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
}
console.log(
	`\n${report.rows} rows in ${(report.bytesEncrypted / 1_048_576).toFixed(1)} MiB encrypted: ${report.ok ? "restore drill passed" : "RESTORE DRILL FAILED"}`,
);
process.exit(report.ok ? 0 : 1);

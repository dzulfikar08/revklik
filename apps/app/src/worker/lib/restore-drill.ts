import { Database } from "bun:sqlite";
import { backupDatabase, BACKUP_PREFIX, type BackupManifest } from "../backup";
import { migrateDatabase } from "../migrations";
import { decryptBackup, importBackupKey } from "./backup-crypto";
import { asBucket, FakeR2 } from "./fake-r2";
import { makeD1 } from "./test-harness";

export interface DrillCheck {
	name: string;
	ok: boolean;
	detail?: string;
}

export interface DrillReport {
	ok: boolean;
	checks: DrillCheck[];
	bytesEncrypted: number;
	rows: number;
}

/** A throwaway 32-byte key for the drill; real keys live in the Worker secret. */
export function drillKey(): string {
	return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

const PLAINTEXT_MARKER = "drill-visitor@example.com";

/** Rows with the values that break naive dumps: quotes, newlines, unicode, NULL, blobs, big and tiny numbers. */
function seed(db: Database, events: number): void {
	db.exec(
		"INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','owner@example.com','x','Owner','user','2026-01-01T00:00:00Z')",
	);
	db.exec(
		"INSERT INTO sites (id, user_id, name, domain, created_at) VALUES ('s1','u1','Site','example.com','2026-01-01T00:00:00Z')",
	);
	db.exec(
		`INSERT INTO visitor_profiles (id, site_id, visitor_id, name, email, notes, first_seen, last_seen)
		 VALUES ('p1','s1','v1','O''Brien "Bob"', '${PLAINTEXT_MARKER}', 'line1' || char(10) || 'line2 ✓ 日本語', '2026-01-01', '2026-01-02')`,
	);
	const insert = db.prepare(
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, revenue, props) VALUES (?,?,?,?,?,?,?,?,?)",
	);
	const padding = "x".repeat(300);
	db.transaction(() => {
		for (let i = 0; i < events; i++) {
			insert.run(
				`e${i}`,
				"s1",
				`ses${i % 50}`,
				"v1",
				new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
				i % 9 === 0 ? "conversion" : "pageview",
				`/page/${i % 40}?q='${i}'`,
				i % 9 === 0 ? i / 7 : null,
				JSON.stringify({ i, pad: padding, quote: "it's" }),
			);
		}
	})();
}

const tableNames = (db: Database): string[] =>
	(
		db
			.query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all() as { name: string }[]
	).map((row) => row.name);

async function digest(db: Database, table: string): Promise<string> {
	const rows = db.query(`SELECT * FROM "${table}" ORDER BY rowid`).all();
	const bytes = new TextEncoder().encode(JSON.stringify(rows));
	return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

/**
 * End-to-end restore rehearsal, all local: seed a migrated database, run the real
 * nightly backup against an in-memory R2, decrypt the stored object with the key,
 * load it into an empty database and compare every table row by row. Also proves
 * the negative cases: no key means no plaintext dump, a wrong key, a flipped byte
 * and a truncated file are all refused.
 */
export async function runRestoreDrill(opts: { events?: number } = {}): Promise<DrillReport> {
	const checks: DrillCheck[] = [];
	const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

	const source = new Database(":memory:");
	await migrateDatabase(makeD1(source) as unknown as D1Database);
	seed(source, opts.events ?? 24_000);
	const sourceRows = tableNames(source).reduce(
		(sum, t) => sum + (source.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n,
		0,
	);

	const bucket = new FakeR2();
	const env = {
		DB: makeD1(source) as unknown as D1Database,
		BACKUP_BUCKET: asBucket(bucket),
	};

	let refused = false;
	try {
		await backupDatabase(env);
	} catch {
		refused = true;
	}
	check("backup without a key is refused", refused);
	check("nothing written without a key", bucket.objects.size === 0);

	const keyText = drillKey();
	await backupDatabase({ ...env, BACKUP_ENCRYPTION_KEY: keyText });
	const dump = [...bucket.objects.entries()].find(([k]) => k.endsWith(".sql.enc"));
	const manifestEntry = [...bucket.objects.entries()].find(([k]) => k.endsWith(".manifest.json"));
	check("encrypted dump stored", Boolean(dump) && dump?.[0].startsWith(BACKUP_PREFIX) === true);
	check("manifest stored", Boolean(manifestEntry));
	const encrypted = dump?.[1].bytes ?? new Uint8Array();

	const haystack = new TextDecoder("latin1").decode(encrypted);
	check(
		"ciphertext holds no readable data",
		!haystack.includes(PLAINTEXT_MARKER) &&
			!haystack.includes("INSERT") &&
			!haystack.includes("CREATE TABLE"),
	);

	const key = await importBackupKey(keyText);
	const sql = new TextDecoder().decode(await decryptBackup(key, encrypted));
	const restored = new Database(":memory:");
	restored.exec(sql);

	const names = tableNames(source);
	check("same tables restored", JSON.stringify(names) === JSON.stringify(tableNames(restored)));
	const mismatched: string[] = [];
	for (const table of names) {
		if ((await digest(source, table)) !== (await digest(restored, table))) mismatched.push(table);
	}
	check("every table identical row by row", mismatched.length === 0, mismatched.join(", "));
	check(
		"restored database passes integrity_check",
		(restored.query("PRAGMA integrity_check").get() as { integrity_check: string })
			.integrity_check === "ok",
	);

	if (manifestEntry) {
		const manifest = JSON.parse(new TextDecoder().decode(manifestEntry[1].bytes)) as BackupManifest;
		const short = Object.entries(manifest.tables).filter(([, c]) => c.dumped !== c.counted);
		check(
			"manifest counts match rows dumped",
			short.length === 0,
			short.map(([t]) => t).join(", "),
		);
	}

	const wrongKey = await importBackupKey(drillKey());
	check("wrong key is refused", await rejects(() => decryptBackup(wrongKey, encrypted)));
	const flipped = encrypted.slice();
	flipped[Math.floor(flipped.length / 2)] ^= 0xff;
	check("a flipped byte is refused", await rejects(() => decryptBackup(key, flipped)));
	check(
		"a truncated file is refused",
		await rejects(() => decryptBackup(key, encrypted.slice(0, encrypted.length - 40))),
	);

	return {
		ok: checks.every((c) => c.ok),
		checks,
		bytesEncrypted: encrypted.length,
		rows: sourceRows,
	};
}

async function rejects(run: () => Promise<unknown>): Promise<boolean> {
	try {
		await run();
		return false;
	} catch {
		return true;
	}
}

/**
 * Rehearse a restore from a real downloaded dump: decrypt it, load it into a
 * scratch SQLite and report integrity plus per-table row counts.
 */
export async function inspectDump(
	encrypted: Uint8Array,
	keyText: string,
): Promise<{ integrity: string; tables: Record<string, number> }> {
	const sql = new TextDecoder().decode(
		await decryptBackup(await importBackupKey(keyText), encrypted),
	);
	const scratch = new Database(":memory:");
	scratch.exec(sql);
	const tables: Record<string, number> = {};
	for (const table of tableNames(scratch)) {
		tables[table] = (
			scratch.query(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }
		).n;
	}
	return {
		integrity: (scratch.query("PRAGMA integrity_check").get() as { integrity_check: string })
			.integrity_check,
		tables,
	};
}

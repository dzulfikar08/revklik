/**
 * Daily full-database snapshot to R2, encrypted.
 *
 * Implemented as a LOGICAL dump (DDL + INSERT OR IGNORE per table) instead of
 * D1's dump(): the dump() endpoint has been answering D1_DUMP_ERROR 400 on
 * these databases since the cron shipped (verified 2026-09-12 on both
 * klikapa-db and klikapa-db-active — the bucket stayed empty). A logical dump
 * needs no platform support and restores with
 * `wrangler d1 execute klikapa-db --remote --file=<dump>.sql` against a fresh
 * database; OR IGNORE makes re-running a restore (or merging into an existing
 * database) conflict-safe.
 *
 * The dump holds every visitor profile and every stored credential, so it never
 * reaches R2 in the clear: it is sealed with AES-256-GCM (lib/backup-crypto.ts)
 * using BACKUP_ENCRYPTION_KEY. Without the key the job refuses to run rather than
 * write a plaintext copy. Restore: docs/backup-restore.md.
 *
 * This is the safety net that survives database DELETION (Time Travel does
 * not: it only covers point-in-time recovery while the database still
 * exists).
 */
import { BackupEncryptor, importBackupKey } from "./lib/backup-crypto";

/** Number of daily dumps to retain. Also the longest a deleted visitor can survive in backups. */
export const KEEP = 30;

export const BACKUP_PREFIX = "klikapa-db/";
const ENCRYPTED_SUFFIX = ".sql.enc";
const MANIFEST_SUFFIX = ".manifest.json";

/** Rows fetched per page while walking a table. */
const PAGE = 5_000;
/** Rows per INSERT statement — bounds statement size. */
const BATCH = 500;

const sqlLit = (v: unknown): string => {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
	if (typeof v === "bigint") return v.toString();
	if (v instanceof Uint8Array)
		return `x'${Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
	return `'${String(v).replace(/'/g, "''")}'`;
};

export interface TableCount {
	/** COUNT(*) taken before the table was walked. */
	counted: number;
	/** Rows written to the dump. */
	dumped: number;
}

/**
 * Walk the database as SQL text. Tables are paged by rowid (keyset), so a row
 * written during the dump is neither skipped nor repeated and the cost stays
 * linear. `counts` fills in per table as the generator advances.
 */
async function* logicalDump(
	db: D1Database,
	counts: Record<string, TableCount>,
): AsyncGenerator<string> {
	yield "PRAGMA defer_foreign_keys=TRUE;\n";

	const schema = await db
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'",
		)
		.all<{ name: string; sql: string }>();
	for (const row of schema.results) {
		yield row.sql.replace(/\n$/, "") + ";\n";
	}

	const tables = await db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'",
		)
		.all<{ name: string }>();
	for (const { name } of tables.results) {
		const quoted = `"${name.replace(/"/g, '""')}"`;
		const total = await db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).first<{ n: number }>();
		const count: TableCount = { counted: total?.n ?? 0, dumped: 0 };
		counts[name] = count;
		let cols: string[] | null = null;
		const colList = () => (cols ??= []).map((c) => `"${c}"`).join(",");
		let after = Number.MIN_SAFE_INTEGER;
		for (;;) {
			const { results } = await db
				.prepare(
					`SELECT rowid AS __rowid, * FROM ${quoted} WHERE rowid > ?1 ORDER BY rowid LIMIT ${PAGE}`,
				)
				.bind(after)
				.all<Record<string, unknown>>();
			if (!results.length) break;
			cols ??= Object.keys(results[0]).filter((c) => c !== "__rowid");
			for (let i = 0; i < results.length; i += BATCH) {
				const values = results
					.slice(i, i + BATCH)
					.map((r) => `(${cols!.map((c) => sqlLit(r[c])).join(",")})`)
					.join(",");
				yield `INSERT OR IGNORE INTO ${quoted} (${colList()}) VALUES${values};\n`;
			}
			count.dumped += results.length;
			after = Number(results[results.length - 1]?.__rowid);
			if (results.length < PAGE) break;
		}
	}
}

export interface BackupManifest {
	format: "RVKBAK01";
	created_at: string;
	key: string;
	bytes: number;
	tables: Record<string, TableCount>;
}

export interface BackupBindings {
	DB?: D1Database;
	BACKUP_BUCKET?: R2Bucket;
	/** Base64 of 32 random bytes. */
	BACKUP_ENCRYPTION_KEY?: string;
}

/** R2 requires every non-trailing multipart part to be EXACTLY the same size (10048 otherwise). */
const PART = 8 * 1024 * 1024;

/**
 * Write one encrypted dump and its manifest, then prune old dumps. Throws on any
 * failure (missing binding or key, R2 error) so the cron runner records it; nothing
 * partial is left behind (the multipart upload is aborted).
 */
export async function backupDatabase(env: BackupBindings): Promise<void> {
	const { DB, BACKUP_BUCKET: bucket } = env;
	if (!DB || !bucket) throw new Error("DB backup: missing DB or BACKUP_BUCKET binding");
	const encryptor = new BackupEncryptor(await importBackupKey(env.BACKUP_ENCRYPTION_KEY));

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const key = `${BACKUP_PREFIX}${stamp}${ENCRYPTED_SUFFIX}`;
	const textEncoder = new TextEncoder();
	const counts: Record<string, TableCount> = {};

	const upload = await bucket.createMultipartUpload(key);
	const buf = new Uint8Array(PART);
	let len = 0;
	let bytes = 0;
	let partNumber = 0;
	const sent: { partNumber: number; etag: string }[] = [];
	const writeBytes = async (encoded: Uint8Array) => {
		let off = 0;
		while (off < encoded.length) {
			const take = Math.min(PART - len, encoded.length - off);
			buf.set(encoded.subarray(off, off + take), len);
			len += take;
			off += take;
			if (len === PART) {
				const part = await upload.uploadPart(++partNumber, buf.slice(0, PART));
				bytes += PART;
				sent.push({ partNumber, etag: part.etag });
				len = 0;
			}
		}
	};
	try {
		for await (const chunk of logicalDump(DB, counts)) {
			for (const sealed of await encryptor.push(textEncoder.encode(chunk)))
				await writeBytes(sealed);
		}
		for (const sealed of await encryptor.finish()) await writeBytes(sealed);
		if (len > 0) {
			const part = await upload.uploadPart(++partNumber, buf.slice(0, len));
			bytes += len;
			sent.push({ partNumber, etag: part.etag });
		}
		await upload.complete(sent);
	} catch (err) {
		await upload.abort().catch(() => {});
		throw err;
	}

	const manifest: BackupManifest = {
		format: "RVKBAK01",
		created_at: new Date().toISOString(),
		key,
		bytes,
		tables: counts,
	};
	await bucket.put(`${BACKUP_PREFIX}${stamp}${MANIFEST_SUFFIX}`, JSON.stringify(manifest));

	const short = Object.entries(counts).filter(([, c]) => c.dumped < c.counted);
	if (short.length) {
		// Rows deleted while the dump ran explain a shortfall; anything else would be a paging bug.
		console.warn(
			`DB backup: fewer rows dumped than counted in ${short.map(([t, c]) => `${t} (${c.dumped}/${c.counted})`).join(", ")}`,
		);
	}

	const pruned = await pruneDumps(bucket);
	console.log(
		`DB backup: wrote ${key} (${bytes} bytes encrypted, ${partNumber} parts); pruned ${pruned}`,
	);
}

/**
 * Keep the newest KEEP encrypted dumps (and their manifests). Plaintext `.sql`
 * dumps written before encryption existed are deleted as soon as an encrypted one
 * is safely stored: they are the one copy of customer data that is readable
 * without a key.
 */
async function pruneDumps(bucket: R2Bucket): Promise<number> {
	const listed = await bucket.list({ prefix: BACKUP_PREFIX });
	const objects = listed.objects;
	const legacy = objects.filter((o) => o.key.endsWith(".sql"));
	const dumps = objects
		.filter((o) => o.key.endsWith(ENCRYPTED_SUFFIX))
		.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
	const stale = dumps.slice(0, Math.max(0, dumps.length - KEEP));
	const doomed = [
		...legacy.map((o) => o.key),
		...stale.flatMap((o) => [o.key, o.key.slice(0, -ENCRYPTED_SUFFIX.length) + MANIFEST_SUFFIX]),
	];
	await Promise.all(doomed.map((key) => bucket.delete(key)));
	return stale.length + legacy.length;
}

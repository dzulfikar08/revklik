/**
 * Daily full-database snapshot to R2.
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
 * This is the safety net that survives database DELETION (Time Travel does
 * not: it only covers point-in-time recovery while the database still
 * exists).
 */

/** Number of daily dumps to retain. */
const KEEP = 30;

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

async function* logicalDump(db: D1Database): AsyncGenerator<string> {
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
		let cols: string[] | null = null;
		const colList = () => (cols ??= []).map((c) => `"${c}"`).join(",");
		for (let offset = 0; ; offset += PAGE) {
			const { results } = await db
				.prepare(`SELECT * FROM ${quoted} LIMIT ${PAGE} OFFSET ${offset}`)
				.all<Record<string, unknown>>();
			if (!results.length) break;
			cols ??= Object.keys(results[0]);
			for (let i = 0; i < results.length; i += BATCH) {
				const values = results
					.slice(i, i + BATCH)
					.map((r) => `(${cols!.map((c) => sqlLit(r[c])).join(",")})`)
					.join(",");
				yield `INSERT OR IGNORE INTO ${quoted} (${colList()}) VALUES${values};\n`;
			}
			if (results.length < PAGE) break;
		}
	}
}

export async function backupDatabase(env: {
	DB?: D1Database;
	BACKUP_BUCKET?: R2Bucket;
}): Promise<void> {
	if (!env.DB || !env.BACKUP_BUCKET) {
		console.error("DB backup: missing DB or BACKUP_BUCKET binding");
		return;
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const key = `klikapa-db/${stamp}.sql`;

	// Stream table chunks into R2 as multipart parts. R2 requires all
	// non-trailing parts to be EXACTLY the same size (10048 otherwise), so
	// chunks are re-buffered into fixed 8 MiB byte slices.
	const PART = 8 * 1024 * 1024;
	const encoder = new TextEncoder();
	const upload = await env.BACKUP_BUCKET.createMultipartUpload(key);
	let buf = new Uint8Array(PART);
	let len = 0;
	let bytes = 0;
	let partNumber = 0;
	const sent: { partNumber: number; etag: string }[] = [];
	try {
		for await (const chunk of logicalDump(env.DB)) {
			const encoded = encoder.encode(chunk);
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
		}
		if (len > 0) {
			const part = await upload.uploadPart(++partNumber, buf.slice(0, len));
			bytes += len;
			sent.push({ partNumber, etag: part.etag });
		}
		if (sent.length === 0) {
			const part = await upload.uploadPart(1, new TextEncoder().encode("-- empty\n"));
			sent.push({ partNumber: 1, etag: part.etag });
		}
		await upload.complete(sent);
	} catch (err) {
		await upload.abort().catch(() => {});
		throw err;
	}

	// Prune: keep only the newest KEEP dumps.
	const listed = await env.BACKUP_BUCKET.list({ prefix: "klikapa-db/" });
	const oldest = listed.objects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
	const stale = oldest.slice(0, Math.max(0, oldest.length - KEEP));
	await Promise.all(stale.map((object) => env.BACKUP_BUCKET!.delete(object.key)));

	console.log(
		`DB backup: wrote ${key} (${bytes} bytes, ${partNumber} parts); pruned ${stale.length}`,
	);
}

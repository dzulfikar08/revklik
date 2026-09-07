/**
 * Daily full-database snapshot to R2.
 *
 * DB.dump() returns the entire database as a single SQL text snapshot —
 * restore with `wrangler d1 execute klikapa-db --remote --file=<dump>.sql`
 * against a freshly created database. This is the safety net that survives
 * database DELETION (Time Travel does not: it only covers point-in-time
 * recovery while the database still exists).
 */

/** Number of daily dumps to retain. */
const KEEP = 30;

export async function backupDatabase(env: {
	DB?: D1Database;
	BACKUP_BUCKET?: R2Bucket;
}): Promise<void> {
	if (!env.DB || !env.BACKUP_BUCKET) {
		console.error("DB backup: missing DB or BACKUP_BUCKET binding");
		return;
	}

	const dump = await env.DB.dump();
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const key = `klikapa-db/${stamp}.sql`;
	await env.BACKUP_BUCKET.put(key, dump);

	// Prune: keep only the newest KEEP dumps.
	const listed = await env.BACKUP_BUCKET.list({ prefix: "klikapa-db/" });
	const oldest = listed.objects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
	const stale = oldest.slice(0, Math.max(0, oldest.length - KEEP));
	await Promise.all(stale.map((object) => env.BACKUP_BUCKET!.delete(object.key)));

	console.log(`DB backup: wrote ${key} (${dump.byteLength} bytes); pruned ${stale.length}`);
}

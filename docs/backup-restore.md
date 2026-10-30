# Backups: encryption, restore and drill

The Worker writes one logical dump of `klikapa-db` to R2 every night (cron `0 3 * * *`, bucket `klikapa-backups`, prefix `klikapa-db/`). The dump contains every visitor profile and every stored integration credential, so it is encrypted before it reaches R2.

## What is stored

| Object | Content |
|---|---|
| `klikapa-db/<stamp>.sql.enc` | The dump, sealed with AES-256-GCM (format below). |
| `klikapa-db/<stamp>.manifest.json` | Plain JSON: creation time, encrypted size, and per table `counted` (COUNT before the table was walked) and `dumped` (rows written). Row counts only, no data. |

The newest 30 dumps are kept (`KEEP` in `apps/app/src/worker/backup.ts`). That is also the longest a deleted visitor, site or account can still exist in backups: **30 days**. The first encrypted run deletes any plaintext `*.sql` dump left from before encryption.

## Key

`BACKUP_ENCRYPTION_KEY` is a Worker secret holding 32 random bytes as base64.

```sh
openssl rand -base64 32                      # generate
cd apps/app && npx wrangler secret put BACKUP_ENCRYPTION_KEY
```

Store a second copy of the key somewhere that is not Cloudflare (password manager, offline). Without it every dump is unreadable by design. With no key set the backup job fails (and mails `SUPER_ADMIN_EMAIL`); it never writes a plaintext dump.

Rotation: set the new key, keep the old one until the dumps made under it have aged out of the 30-day window. The format carries no key id, so try the old key when a new one fails authentication.

## Restore

1. Pick the dump and download it (needs R2 access, not the key):
   ```sh
   cd apps/app
   npx wrangler r2 object get klikapa-backups/klikapa-db/<stamp>.sql.enc --remote --file dump.sql.enc
   ```
2. Decrypt and check it locally. This loads it into a scratch SQLite, prints `integrity_check` and a row count per table, and writes the SQL:
   ```sh
   BACKUP_ENCRYPTION_KEY='<base64 key>' bun scripts/restore-drill.ts --file dump.sql.enc --sql-out dump.sql
   ```
   Compare the counts with the manifest next to the dump. A wrong key, a flipped byte or a truncated file stops here with `failed authentication`.
3. Create a fresh database and load the SQL. Statements are `INSERT OR IGNORE`, so a repeat or a merge into a non-empty database is safe:
   ```sh
   npx wrangler d1 create klikapa-db-restored
   npx wrangler d1 execute klikapa-db-restored --remote --file dump.sql
   ```
4. Point `d1_databases` in `wrangler.jsonc` at the new database id and deploy, or keep the old database and copy missing rows across. Do not delete the dump until the app has run against the restored data.
5. Time Travel (`wrangler d1 time-travel restore`) is the faster path while the database still exists and the point in time is inside its window. These dumps are for the case Time Travel cannot cover: the database is gone.

If a deleted visitor, site or account is restored from a dump, delete it again before serving traffic (visitor and account erasure endpoints, or the site delete).

## Drill

```sh
cd apps/app && bun scripts/restore-drill.ts
```

No credentials needed. It seeds a migrated database (about 24,000 rows with quotes, newlines, unicode, NULLs, tiny and large numbers), runs the real `backupDatabase` against an in-memory R2, decrypts the stored object and loads it into an empty database, then compares every table row by row and runs `integrity_check`. It also proves four refusals: no key writes nothing, and a wrong key, a flipped byte and a truncated file all fail to decrypt. Exit code 0 only when every check passes. The same checks run in `bun test src/worker/backup.test.ts`.

Run it after changing `backup.ts`, `backup-crypto.ts` or the schema, and run the real-dump mode (step 2) on a downloaded dump at least once a quarter.

## Format (`RVKBAK01`)

```
file   = "RVKBAK01" | frame*
frame  = u32 BE length of (ciphertext + tag) | 12-byte IV | ciphertext + 16-byte tag
cipher = AES-256-GCM, fresh random IV per frame, 1 MiB of plaintext per frame
AAD    = "RVKBAK01" | u32 BE frame index | u8 final-frame flag
```

The AAD binds every frame to its position and marks the last one, so reordered, dropped, appended or truncated frames fail authentication. Implementation: `apps/app/src/worker/lib/backup-crypto.ts`.

## Cron layout

The backup runs alone in its own trigger (`0 3 * * *`) so it has a whole invocation's limits to itself. Nightly upkeep (retention purge, FX refresh, currency backfill, Pakasir carry-over, push outbox prune) runs at `30 3 * * *`. Inside every trigger each job is isolated: a failure is logged, mailed to `SUPER_ADMIN_EMAIL` (at most once per 12 hours per job) and does not stop the next job.

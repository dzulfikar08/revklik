import { createDb } from "./db";
import { computedSourceSql } from "./lib/source-sql";

/**
 * Version the live schema must reach. Bump it whenever a step is appended to
 * VERSIONED_STEPS; a DB already at this version costs one SELECT per isolate.
 */
export const SCHEMA_VERSION = 17;

const migrated = new WeakSet<D1Database>();

/** True once migrateDatabase has completed for this D1 binding on this isolate. */
export const hasMigrated = (d1: D1Database): boolean => migrated.has(d1);

const ALREADY_APPLIED_RE = /duplicate column|already exists|no such index/i;

/** Run one idempotent DDL statement; only "already applied" errors are swallowed. */
async function runDdl(d1: D1Database, statement: string): Promise<void> {
	try {
		await d1.prepare(statement).run();
	} catch (err) {
		if (err instanceof Error && ALREADY_APPLIED_RE.test(err.message)) return;
		throw err;
	}
}

/**
 * Data repair whose absence is merely cosmetic: a failure is logged and the
 * version still advances. Repairs that correctness depends on use runDdl-style
 * statements that throw, so the version is not stamped and the next isolate retries.
 */
async function runBackfill(d1: D1Database, statement: string, ...params: unknown[]): Promise<void> {
	try {
		await d1
			.prepare(statement)
			.bind(...params)
			.run();
	} catch (err) {
		console.error("migration backfill skipped:", err);
	}
}

const SCHEMA_VERSION_TABLE =
	"CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, updated_at TEXT NOT NULL)";

interface MigrationStep {
	version: number;
	run: (d1: D1Database) => Promise<void>;
}

const VERSIONED_STEPS: MigrationStep[] = [
	{ version: 1, run: baselineSchema },
	{ version: 2, run: (d1) => runDdl(d1, SCHEMA_VERSION_TABLE) },
	{ version: 3, run: billingIntegritySchema },
	{
		version: 4,
		run: (d1) =>
			runDdl(d1, "ALTER TABLE sites ADD COLUMN revenue_currency TEXT NOT NULL DEFAULT 'USD'"),
	},
	{
		version: 5,
		run: (d1) =>
			runDdl(
				d1,
				"CREATE TABLE IF NOT EXISTS account_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, events INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))",
			),
	},
	{ version: 6, run: (d1) => runDdl(d1, "ALTER TABLE users ADD COLUMN intended_plan TEXT") },
	{ version: 7, run: authHardeningSchema },
	// No query filters events on payment_provider/payment_method (revenue-by-method
	// groups after a site_id + revenue range, served by idx_events_site_revenue_time),
	// so this 4-column index only costs writes and storage.
	{ version: 8, run: (d1) => runDdl(d1, "DROP INDEX IF EXISTS idx_events_site_payment") },
	{
		version: 9,
		// NULL = existing site whose currency the 03:00 cron has not inferred yet
		// (lib/currency-backfill.ts); 'auto', 'user' or 'default' once settled.
		run: (d1) => runDdl(d1, "ALTER TABLE sites ADD COLUMN revenue_currency_source TEXT"),
	},
	{ version: 10, run: accountProofSchema },
	{ version: 11, run: preDeployRepairs },
	{ version: 12, run: botFilterSchema },
	{
		version: 13,
		run: (d1) =>
			runDdl(
				d1,
				"CREATE TABLE IF NOT EXISTS fx_rates (currency TEXT PRIMARY KEY, per_usd REAL NOT NULL, as_of TEXT NOT NULL)",
			),
	},
	{ version: 14, run: revenueAggregationSchema },
	{ version: 15, run: pushAlertsSchema },
	{
		version: 16,
		run: (d1) =>
			runDdl(
				d1,
				// Literal `revenue != 0` in queries is required for the planner to pick this; a bound param does not match.
				"CREATE INDEX IF NOT EXISTS idx_events_revenue_partial ON events(site_id, timestamp) WHERE revenue != 0",
			),
	},
	{ version: 17, run: sourceSchema },
];

/** Rows rewritten per backfill statement: far below D1's per-query CPU and row-write limits. */
const SOURCE_BACKFILL_CHUNK = 2000;

/**
 * Per-row traffic source: nullable column on events and sessions (metadata-only
 * ALTER), then the existing SQL classification written into rows that predate it.
 * Ingest stamps new rows (lib/source-stamp-plugin.ts); reads fall back to computing
 * the source for any row still NULL, so a skipped or partial backfill only costs speed.
 */
async function sourceSchema(d1: D1Database): Promise<void> {
	await runDdl(d1, "ALTER TABLE events ADD COLUMN source TEXT");
	await runDdl(d1, "ALTER TABLE sessions ADD COLUMN source TEXT");
	const expression = computedSourceSql.compile(createDb(d1)).sql;
	for (const table of ["events", "sessions"]) {
		try {
			await backfillSource(d1, table, expression);
		} catch (err) {
			console.error(`source backfill stopped on ${table}:`, err);
		}
	}
}

/** Fills `source` where NULL, one rowid-bounded UPDATE per SOURCE_BACKFILL_CHUNK rows; resumable. */
async function backfillSource(d1: D1Database, table: string, expression: string): Promise<void> {
	const first = await d1
		.prepare(`SELECT MIN(rowid) AS lo FROM ${table}`)
		.all<{ lo: number | null }>();
	let from = first.results[0]?.lo;
	while (from !== null && from !== undefined) {
		// Exclusive upper bound: the rowid one chunk further on; none means this is the last chunk.
		const edge = await d1
			.prepare(`SELECT rowid AS r FROM ${table} WHERE rowid >= ? ORDER BY rowid LIMIT 1 OFFSET ?`)
			.bind(from, SOURCE_BACKFILL_CHUNK)
			.all<{ r: number }>();
		const until = edge.results[0]?.r;
		const bounded = until === undefined ? "" : "AND rowid < ?";
		const bounds = until === undefined ? [from] : [from, until];
		await d1
			.prepare(
				`UPDATE ${table} SET source = ${expression} WHERE source IS NULL AND rowid >= ? ${bounded}`,
			)
			.bind(...bounds)
			.run();
		from = until;
	}
}

/**
 * Cross-product revenue: payment rail, product slug and net-after-fees on each
 * event (nullable metadata-only ALTERs), plus per-owner fee rules overriding
 * the built-in defaults in lib/fees.ts.
 */
async function revenueAggregationSchema(d1: D1Database): Promise<void> {
	for (const statement of [
		"ALTER TABLE events ADD COLUMN rail TEXT",
		"ALTER TABLE events ADD COLUMN product TEXT",
		"ALTER TABLE events ADD COLUMN net_revenue REAL",
		"ALTER TABLE events ADD COLUMN net_source TEXT",
		`CREATE TABLE IF NOT EXISTS fee_rules (
      user_id TEXT NOT NULL,
      rail TEXT NOT NULL,
      percent_bps INTEGER NOT NULL,
      fixed_amount REAL NOT NULL DEFAULT 0,
      fixed_currency TEXT,
      updated_at INTEGER,
      PRIMARY KEY (user_id, rail)
    )`,
	]) {
		await runDdl(d1, statement);
	}
}

/**
 * Sale alerts to the phone app: Expo push devices (one token = one row, owned by
 * whoever signed in last), per-user sale/refund toggles, and the outbox that makes
 * delivery retryable and idempotent per (user, event). Replaces the never-used
 * push_tokens table.
 */
async function pushAlertsSchema(d1: D1Database): Promise<void> {
	for (const statement of [
		"DROP TABLE IF EXISTS push_tokens",
		`CREATE TABLE IF NOT EXISTS push_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expo_token TEXT NOT NULL,
      platform TEXT NOT NULL,
      locale TEXT,
      app_version TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices(expo_token)",
		"CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id)",
		`CREATE TABLE IF NOT EXISTS push_prefs (
      user_id TEXT PRIMARY KEY,
      sales INTEGER NOT NULL DEFAULT 1,
      refunds INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )`,
		`CREATE TABLE IF NOT EXISTS push_outbox (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      tickets_json TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    )`,
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_push_outbox_user_event ON push_outbox(user_id, event_id)",
		"CREATE INDEX IF NOT EXISTS idx_push_outbox_status ON push_outbox(status, created_at)",
	]) {
		await runDdl(d1, statement);
	}
}

const CHECKOUT_STATUSES = "('open', 'expired', 'confirmed', 'succeeded', 'failed')";

/**
 * Every account that exists when this runs predates email verification and is
 * treated as verified, so a later Google sign-in never wipes a real owner's
 * password. Only signups after this deploy can be unverified. Rows that the old
 * checkout.created branch overwrote carry a checkout status and checkout id:
 * the id is cleared (the next subscription event re-attaches the real one) and
 * the status restored from the period.
 */
async function preDeployRepairs(d1: D1Database): Promise<void> {
	await runDdl(
		d1,
		"UPDATE users SET email_verified_at = COALESCE(created_at, datetime('now')) WHERE email_verified_at IS NULL",
	);
	await runBackfill(
		d1,
		`UPDATE subscriptions
       SET polar_subscription_id = NULL,
           status = CASE WHEN current_period_end > ? THEN 'active' ELSE 'canceled' END
       WHERE status IN ${CHECKOUT_STATUSES}`,
		new Date().toISOString(),
	);
}

/** Review fixes: QRIS-paid horizon, email verification. */
async function accountProofSchema(d1: D1Database): Promise<void> {
	await runDdl(d1, "ALTER TABLE subscriptions ADD COLUMN pakasir_paid_until TEXT");
	await runDdl(d1, "ALTER TABLE users ADD COLUMN email_verified_at TEXT");
	await runDdl(
		d1,
		"CREATE TABLE IF NOT EXISTS email_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
	);
	await runDdl(d1, "CREATE INDEX IF NOT EXISTS idx_ev_user ON email_verifications(user_id)");
	// Google accounts proved their address at sign-in.
	await runBackfill(
		d1,
		"UPDATE users SET email_verified_at = created_at WHERE google_id IS NOT NULL AND email_verified_at IS NULL",
	);
	// Rows already active on a QRIS order keep that period as their floor.
	await runBackfill(
		d1,
		"UPDATE subscriptions SET pakasir_paid_until = current_period_end WHERE pakasir_order_id IS NOT NULL AND status = 'active' AND pakasir_paid_until IS NULL",
	);
}

/** DEV-34: password resets, D1 login throttle, session expiry, referral commissions. */
async function authHardeningSchema(d1: D1Database): Promise<void> {
	await runDdl(
		d1,
		"CREATE TABLE IF NOT EXISTS password_resets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
	);
	await runDdl(d1, "CREATE INDEX IF NOT EXISTS idx_pr_user ON password_resets(user_id)");
	await runDdl(
		d1,
		"CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start TEXT NOT NULL)",
	);
	await runDdl(d1, "CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))");
	await runDdl(d1, "ALTER TABLE referrals ADD COLUMN source_ref TEXT");
	await runDdl(d1, "CREATE UNIQUE INDEX IF NOT EXISTS idx_ref_source ON referrals(source_ref)");
	// Sessions minted before expiry existed get the same 30-day horizon as new ones.
	await runBackfill(
		d1,
		"UPDATE api_keys SET expires_at = ? WHERE token_type = 'session' AND expires_at IS NULL",
		new Date(Date.now() + 30 * 86_400_000).toISOString(),
	);
}

/** DEV-29: QRIS orders live outside subscriptions; webhook idempotency keys. */
async function billingIntegritySchema(d1: D1Database): Promise<void> {
	await runDdl(
		d1,
		`CREATE TABLE IF NOT EXISTS pakasir_orders (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL,
      checkout_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`,
	);
	await runDdl(
		d1,
		"CREATE INDEX IF NOT EXISTS idx_po_user ON pakasir_orders(user_id, status, created_at)",
	);
	await runDdl(
		d1,
		"CREATE TABLE IF NOT EXISTS webhook_dedupe (key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
	);
	await carryOverPakasirOrders(d1);
	// subscription.canceled used to end access immediately; rows still inside a
	// paid period get their access back (they stay flagged cancel_at_period_end).
	await runBackfill(
		d1,
		"UPDATE subscriptions SET status = 'active' WHERE status = 'canceled' AND cancel_at_period_end = 1 AND polar_subscription_id IS NOT NULL AND current_period_end > ?",
		new Date().toISOString(),
	);
}

/**
 * Copy QRIS orders recorded on subscription rows into pakasir_orders (an active
 * row's order lands as completed so it cannot be replayed). Idempotent and
 * non-fatal: the Pakasir webhook also adopts legacy orders on sight, and the
 * 03:00 cron re-runs this.
 */
export async function carryOverPakasirOrders(d1: D1Database): Promise<void> {
	await runBackfill(
		d1,
		`INSERT INTO pakasir_orders (order_id, user_id, plan, amount, checkout_url, status, created_at, processed_at)
       SELECT pakasir_order_id, user_id, plan,
         CASE plan WHEN 'micro' THEN 16000 WHEN 'starter' THEN 64000 ELSE 192000 END,
         'https://app.pakasir.com/pay/revklik/' || CASE plan WHEN 'micro' THEN 16000 WHEN 'starter' THEN 64000 ELSE 192000 END || '?order_id=' || pakasir_order_id || '&qris_only=1',
         CASE WHEN status = 'pending' THEN 'pending' ELSE 'completed' END,
         updated_at,
         CASE WHEN status = 'pending' THEN NULL ELSE updated_at END
       FROM subscriptions
       WHERE pakasir_order_id IS NOT NULL AND plan IN ('micro', 'starter', 'growth')
       ON CONFLICT(order_id) DO NOTHING`,
	);
}

async function readSchemaVersion(d1: D1Database): Promise<number> {
	try {
		const row = await d1
			.prepare("SELECT version FROM schema_version WHERE id = 1")
			.first<{ version: number }>();
		return Number(row?.version ?? 0);
	} catch {
		return 0;
	}
}

const LOCK_TTL_MS = 120_000;

/**
 * One isolate migrates at a time: the lock row is taken when absent or stale
 * (a crashed holder frees it after LOCK_TTL_MS). Losers skip this round; the
 * app middleware retries a minute later.
 */
async function acquireMigrationLock(d1: D1Database, token: string): Promise<boolean> {
	await runDdl(
		d1,
		"CREATE TABLE IF NOT EXISTS migration_lock (id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL, locked_at TEXT NOT NULL)",
	);
	const now = Date.now();
	const rows = await d1
		.prepare(
			"INSERT INTO migration_lock (id, token, locked_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, locked_at = excluded.locked_at WHERE migration_lock.locked_at < ? RETURNING token",
		)
		.bind(token, new Date(now).toISOString(), new Date(now - LOCK_TTL_MS).toISOString())
		.all<{ token: string }>();
	return rows.results?.[0]?.token === token;
}

async function releaseMigrationLock(d1: D1Database, token: string): Promise<void> {
	try {
		await d1.prepare("DELETE FROM migration_lock WHERE id = 1 AND token = ?").bind(token).run();
	} catch {
		/* expires on its own */
	}
}

const LOCK_POLL_MS = 250;
const LOCK_WAIT_MS = 15_000;

/**
 * Another isolate is migrating: hold this request until the schema reaches
 * SCHEMA_VERSION so it never runs against missing columns. True on success.
 */
async function waitForMigration(d1: D1Database, waitMs: number): Promise<boolean> {
	const deadline = Date.now() + waitMs;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
		if ((await readSchemaVersion(d1)) >= SCHEMA_VERSION) return true;
	}
	return false;
}

export async function migrateDatabase(
	d1: D1Database,
	opts: { lockWaitMs?: number } = {},
): Promise<void> {
	if (migrated.has(d1)) return;

	const current = await readSchemaVersion(d1);
	if (current < SCHEMA_VERSION) {
		const token = crypto.randomUUID();
		if (!(await acquireMigrationLock(d1, token))) {
			if (await waitForMigration(d1, opts.lockWaitMs ?? LOCK_WAIT_MS)) migrated.add(d1);
			else console.error("migration lock held past the wait budget; serving on the current schema");
			return;
		}
		try {
			// Re-read under the lock: another isolate may have finished meanwhile.
			const locked = await readSchemaVersion(d1);
			for (const step of VERSIONED_STEPS) {
				if (step.version > locked) await step.run(d1);
			}
			await runDdl(d1, SCHEMA_VERSION_TABLE);
			await d1
				.prepare(
					"INSERT INTO schema_version (id, version, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = MAX(version, excluded.version), updated_at = excluded.updated_at",
				)
				.bind(SCHEMA_VERSION, new Date().toISOString())
				.run();
		} finally {
			await releaseMigrationLock(d1, token);
		}
	}
	migrated.add(d1);
}

/**
 * Bot flagging, capped session duration and server-event idempotency. Every
 * statement is a metadata-only ALTER (constant defaults), so the step is O(1)
 * on a large events table; lib/bot-reclassify.ts fills the data afterwards.
 */
async function botFilterSchema(d1: D1Database): Promise<void> {
	for (const statement of [
		"ALTER TABLE events ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE events ADD COLUMN external_id TEXT",
		"ALTER TABLE sessions ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE sessions ADD COLUMN bot_reason TEXT",
		"ALTER TABLE sessions ADD COLUMN active_seconds INTEGER",
		"ALTER TABLE sessions ADD COLUMN as_org TEXT",
		"ALTER TABLE visitor_profiles ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0",
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_events_site_external ON events(site_id, external_id) WHERE external_id IS NOT NULL",
	]) {
		await runDdl(d1, statement);
	}
	// Orders booked before external_id existed keep deduping: lift the Polar order
	// id out of props, one row per (site, order) so the unique index holds.
	await runBackfill(
		d1,
		`UPDATE events
		 SET external_id = CASE WHEN json_valid(props) THEN json_extract(props, '$.polar_order_id') END
		 WHERE external_id IS NULL AND event_type = 'conversion' AND json_valid(props)
		   AND json_extract(props, '$.polar_order_id') IS NOT NULL
		   AND id IN (
		     SELECT MIN(id) FROM events
		     WHERE event_type = 'conversion' AND json_valid(props)
		       AND json_extract(props, '$.polar_order_id') IS NOT NULL
		     GROUP BY site_id, json_extract(props, '$.polar_order_id'))`,
	);
}

/** Pre-versioning schema: every statement is idempotent and tolerates partial prior runs. */
async function baselineSchema(d1: D1Database): Promise<void> {
	try {
		await d1.batch([
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'default', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, props TEXT)",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1)",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, avatar TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, total_sessions INTEGER NOT NULL DEFAULT 0, total_pageviews INTEGER NOT NULL DEFAULT 0, total_revenue REAL NOT NULL DEFAULT 0, tags TEXT, notes TEXT)",
			),
			d1.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_site_visitor ON visitor_profiles(site_id, visitor_id)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_time ON events(site_id, timestamp)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_session ON events(site_id, session_id)",
			),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_visitor ON events(site_id, visitor_id)",
			),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_type ON events(site_id, event_type, timestamp)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id, started_at)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(site_id, visitor_id)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)"),
		]);
	} catch {
		// tables may already exist
	}

	try {
		await d1.prepare("SELECT user_id FROM sites LIMIT 1").all();
	} catch {
		// The SELECT can fail transiently (or because the DB is briefly
		// unreachable) — never drop a table because of it. Only create the
		// table when it genuinely does not exist.
		try {
			const sitesTable = await d1
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites'")
				.first();
			if (!sitesTable) {
				await d1.batch([
					d1.prepare(
						"CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
					),
					d1.prepare("CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id)"),
				]);
			}
		} catch (err) {
			console.error("sites table bootstrap skipped:", err);
		}
	}

	// Migrate: add region and city columns to existing tables
	const alterStatements = [
		"ALTER TABLE events ADD COLUMN region TEXT",
		"ALTER TABLE sessions ADD COLUMN region TEXT",
		"ALTER TABLE sessions ADD COLUMN city TEXT",
		"ALTER TABLE visitor_profiles ADD COLUMN region TEXT",
	];
	for (const stmt of alterStatements) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}

	// Migrate: add missing indexes for query performance
	const indexStatements = [
		"CREATE INDEX IF NOT EXISTS idx_events_site_name_time ON events(site_id, name, timestamp)",
		"CREATE INDEX IF NOT EXISTS idx_events_site_path ON events(site_id, path)",
		"CREATE INDEX IF NOT EXISTS idx_vp_site_last_seen ON visitor_profiles(site_id, last_seen)",
	];
	for (const stmt of indexStatements) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* index may already exist */
		}
	}

	// Migrate: add fingerprint column for cookieless attribution
	const fingerprintStatements = [
		"ALTER TABLE events ADD COLUMN fingerprint TEXT",
		"ALTER TABLE sessions ADD COLUMN fingerprint TEXT",
		"ALTER TABLE visitor_profiles ADD COLUMN fingerprint TEXT",
	];
	for (const stmt of fingerprintStatements) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	const fingerprintIndexes = [
		"CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON events(site_id, fingerprint)",
		"CREATE INDEX IF NOT EXISTS idx_sessions_fingerprint ON sessions(site_id, fingerprint)",
		"CREATE INDEX IF NOT EXISTS idx_vp_fingerprint ON visitor_profiles(site_id, fingerprint)",
	];
	for (const stmt of fingerprintIndexes) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* index may already exist */
		}
	}

	// Heatmap click data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS heatmap_clicks (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      element_selector TEXT,
      element_text TEXT,
      viewport_width INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_hmc_site_path ON heatmap_clicks(site_id, path, timestamp)",
			),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_hmc_site_time ON heatmap_clicks(site_id, timestamp)",
			),
		]);
	} catch {
		/* table may already exist */
	}

	// Heatmap scroll data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS heatmap_scrolls (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      max_scroll REAL NOT NULL,
      viewport_height INTEGER,
      doc_height INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_hms_site_path ON heatmap_scrolls(site_id, path, timestamp)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Session recordings
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS session_recordings (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      events TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      viewport_width INTEGER,
      viewport_height INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_sr_site ON session_recordings(site_id, started_at)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_sr_session ON session_recordings(session_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Aggregated heatmap data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS heatmap_aggregates (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      path TEXT NOT NULL,
      period TEXT NOT NULL,
      click_grid TEXT NOT NULL,
      scroll_depths TEXT NOT NULL,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      total_clicks INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_hma_site_path_period ON heatmap_aggregates(site_id, path, period)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Integrations
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_int_site ON integrations(site_id)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_int_user ON integrations(user_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Webhook events log
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_site ON webhook_events(site_id, created_at)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_status ON webhook_events(status, created_at)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_int ON webhook_events(integration_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// AI insights cache
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      range TEXT NOT NULL,
      insight_type TEXT NOT NULL,
      insight_text TEXT NOT NULL,
      data_refs TEXT,
      confidence REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_ai_site ON ai_insights(site_id, range, insight_type)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_ai_expires ON ai_insights(expires_at)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Subscriptions
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TEXT NOT NULL DEFAULT (datetime('now')),
      current_period_end TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      polar_subscription_id TEXT,
      polar_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_sub_polar ON subscriptions(polar_subscription_id)",
			),
		]);
	} catch {
		/* table may already exist */
	}

	// Migrate: pakasir_order_id for QRIS checkout verification
	try {
		await d1.prepare("ALTER TABLE subscriptions ADD COLUMN pakasir_order_id TEXT").run();
	} catch {
		/* column may already exist */
	}

	// Team members
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      invited_by TEXT NOT NULL,
      invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_site_user ON team_members(site_id, user_id)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Migrate: add google_id, avatar_url, role to users
	for (const stmt of [
		"ALTER TABLE users ADD COLUMN google_id TEXT",
		"ALTER TABLE users ADD COLUMN avatar_url TEXT",
		"ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	try {
		await d1
			.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id)")
			.run();
	} catch {
		/* index may already exist */
	}

	// Revenue analytics index for fast revenue breakdown queries
	try {
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_revenue_time ON events(site_id, revenue, timestamp)",
			)
			.run();
	} catch {
		/* index may already exist */
	}

	// Public API: extend api_keys with token types, scopes, site binding, usage tracking
	for (const stmt of [
		"ALTER TABLE api_keys ADD COLUMN token_type TEXT NOT NULL DEFAULT 'session'",
		"ALTER TABLE api_keys ADD COLUMN scopes TEXT",
		"ALTER TABLE api_keys ADD COLUMN site_id TEXT",
		"ALTER TABLE api_keys ADD COLUMN last_used_at TEXT",
		"ALTER TABLE api_keys ADD COLUMN expires_at TEXT",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	try {
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(user_id, token_type)")
			.run();
	} catch {
		/* index may already exist */
	}

	// Payment provider configurations per site
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS payment_providers (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_pp_site ON payment_providers(site_id)").run();
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_pp_site_provider ON payment_providers(site_id, provider)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Webhook delivery log for payment providers
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_wl_site ON webhook_logs(site_id)").run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_wl_site_provider ON webhook_logs(site_id, provider)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Saved segments
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_segments_site ON segments(site_id)").run();
	} catch {
		/* table may already exist */
	}

	// Chart annotations
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      date TEXT NOT NULL,
      text TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_annotations_site ON annotations(site_id, date)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Email reports config
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS email_reports (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'weekly',
      enabled INTEGER DEFAULT 1,
      last_sent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_er_site ON email_reports(site_id)").run();
	} catch {
		/* table may already exist */
	}

	// Payment-related columns on events and sites
	for (const stmt of [
		"ALTER TABLE events ADD COLUMN payment_provider TEXT",
		"ALTER TABLE events ADD COLUMN payment_method TEXT",
		"ALTER TABLE events ADD COLUMN currency TEXT DEFAULT 'USD'",
		"ALTER TABLE events ADD COLUMN subscription_id TEXT",
		"ALTER TABLE sites ADD COLUMN share_token TEXT",
		"ALTER TABLE sites ADD COLUMN public_dashboard INTEGER DEFAULT 0",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	try {
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_payment ON events(site_id, payment_provider, payment_method, timestamp)",
			)
			.run();
	} catch {
		/* index may already exist */
	}

	// Backfill payment columns from webhook props (handlers wrote JSON-only before columns existed)
	for (const stmt of [
		`UPDATE events
		 SET payment_provider = REPLACE(json_extract(props, '$.source'), '_webhook', '')
		 WHERE payment_provider IS NULL
		 AND revenue > 0
		 AND json_extract(props, '$.source') IS NOT NULL`,
		`UPDATE events
		 SET payment_method = json_extract(props, '$.payment_method')
		 WHERE payment_method IS NULL
		 AND json_extract(props, '$.payment_method') IS NOT NULL`,
		`UPDATE events
		 SET currency = json_extract(props, '$.currency')
		 WHERE currency IS NULL
		 AND json_extract(props, '$.currency') IS NOT NULL`,
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* props may be invalid JSON */
		}
	}

	// Search Console data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS search_console_data (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      date TEXT NOT NULL,
      query TEXT NOT NULL,
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr REAL DEFAULT 0,
      position REAL DEFAULT 0,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_scd_site_date ON search_console_data(site_id, date)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Marketplace orders
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      order_id TEXT NOT NULL,
      order_sn TEXT NOT NULL,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'IDR',
      status TEXT DEFAULT 'pending',
      buyer_info TEXT,
      items TEXT,
      ordered_at TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_unique ON marketplace_orders(site_id, marketplace, order_sn)",
			)
			.run();
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_mo_site ON marketplace_orders(site_id, marketplace, ordered_at)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Affiliates
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS affiliates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      referral_code TEXT NOT NULL UNIQUE,
      commission_rate REAL DEFAULT 0.2,
      total_earned REAL DEFAULT 0,
      total_paid REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_aff_user ON affiliates(user_id)").run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_aff_code ON affiliates(referral_code)").run();
	} catch {
		/* table may already exist */
	}

	// Referrals
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT 'signup',
      commission_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_ref_affiliate ON referrals(affiliate_id)")
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_ref_user ON referrals(referred_user_id)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Self-traffic exclusion: per-site fingerprint blocklist (JSON text array)
	for (const stmt of ["ALTER TABLE sites ADD COLUMN excluded_fingerprints TEXT"]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}

	// Embeddable live-stats widget (per-site opt-in + opaque token + tz offset for "today")
	for (const stmt of [
		"ALTER TABLE sites ADD COLUMN widget_enabled INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE sites ADD COLUMN widget_token TEXT",
		"ALTER TABLE sites ADD COLUMN widget_tz_offset INTEGER NOT NULL DEFAULT 0",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	// AI/other crawler hits for the Crawlers analytics panel (bots excluded
	// from human analytics are recorded here instead of being dropped)
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS crawler_hits (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      bot TEXT NOT NULL,
      category TEXT NOT NULL,
      path TEXT,
      user_agent TEXT,
      country TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_ch_site_time ON crawler_hits(site_id, timestamp)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_ch_site_bot ON crawler_hits(site_id, bot, timestamp)",
			),
		]);
	} catch {
		/* table may already exist */
	}

	// App Store Connect: daily app totals (sales-report sync) and per-country
	// detail. customer_price is the per-unit tier price actually charged that
	// day — price-change annotations are derived from it.
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS asc_daily_metrics (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      date TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 0,
      proceeds REAL NOT NULL DEFAULT 0,
      iap_units INTEGER NOT NULL DEFAULT 0,
      iap_proceeds REAL NOT NULL DEFAULT 0,
      proceeds_currency TEXT,
      impressions INTEGER,
      page_views INTEGER,
      paying_users INTEGER,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_asc_m_unique ON asc_daily_metrics(site_id, app_id, date)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_asc_m_site ON asc_daily_metrics(site_id, date)"),
		]);
	} catch {
		/* table may already exist */
	}
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS asc_daily_country (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      date TEXT NOT NULL,
      country TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 0,
      proceeds REAL NOT NULL DEFAULT 0,
      customer_price REAL,
      customer_currency TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_asc_c_unique ON asc_daily_country(site_id, app_id, date, country)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_asc_c_site ON asc_daily_country(site_id, date)"),
		]);
	} catch {
		/* table may already exist */
	}
}

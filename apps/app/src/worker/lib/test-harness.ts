import { Database } from "bun:sqlite";
import { generateId, hashToken } from "../utils";

export interface D1Like {
	__db: Database;
	prepare: (sql: string) => {
		bind: (...params: unknown[]) => {
			all: () => Promise<{ results: unknown[] }>;
			run: () => Promise<unknown>;
		};
		run: (...params: unknown[]) => Promise<unknown>;
		all: () => Promise<{ results: unknown[] }>;
		first: () => Promise<unknown>;
	};
	batch: (stmts: Array<{ run: () => Promise<unknown> }>) => Promise<unknown[]>;
}

/**
 * bun:sqlite-backed D1 stand-in for tests. prepare() is lazy — D1 compiles
 * statements at execution time, so `CREATE INDEX` may sit in a batch ahead of
 * its `CREATE TABLE`; bun:sqlite compiles eagerly and would fail early.
 */
export function makeD1(db: Database): D1Like {
	return {
		__db: db,
		prepare(sql: string) {
			let stmt: ReturnType<Database["prepare"]> | null = null;
			const get = () => (stmt ??= db.prepare(sql));
			return {
				bind: (...params: unknown[]) => ({
					all: async () => ({ results: get().all(...(params as never[])) }),
					run: async () => {
						get().run(...(params as never[]));
						return { success: true };
					},
				}),
				run: async (...params: unknown[]) => {
					get().run(...(params as never[]));
					return { success: true };
				},
				all: async () => ({ results: get().all() }),
				first: async () => get().get() ?? null,
			};
		},
		async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
			for (const s of stmts) await s.run();
			return [];
		},
	};
}

/**
 * Minimal tables for route-level tests. The migrations module has a
 * process-wide "already ran" guard, so a second test file with a fresh
 * in-memory DB cannot go through migrateDatabase again.
 */
export function createRouteTables(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, google_id TEXT, avatar_url TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS asc_daily_country (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, app_id TEXT NOT NULL, date TEXT NOT NULL, country TEXT NOT NULL, units INTEGER NOT NULL DEFAULT 0, proceeds REAL NOT NULL DEFAULT 0, customer_price REAL, customer_currency TEXT, synced_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', invited_by TEXT, invited_at TEXT, accepted_at TEXT);
		CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'default', token_type TEXT, scopes TEXT, site_id TEXT, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, config TEXT, enabled INTEGER DEFAULT 1, last_sync TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS asc_daily_metrics (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, app_id TEXT NOT NULL, date TEXT NOT NULL, units INTEGER NOT NULL DEFAULT 0, proceeds REAL NOT NULL DEFAULT 0, iap_units INTEGER NOT NULL DEFAULT 0, iap_proceeds REAL NOT NULL DEFAULT 0, proceeds_currency TEXT, impressions INTEGER, page_views INTEGER, paying_users INTEGER, synced_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, date TEXT NOT NULL, text TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
	`);
}

/** Seed a user + site + a kp_-prefixed session API key; returns the token. */
export async function seedSiteWithSessionKey(
	d1: D1Like,
): Promise<{ token: string; siteId: string }> {
	const now = new Date().toISOString();
	const token = `kp_test_${generateId()}`;
	await d1
		.prepare(
			"INSERT INTO users (id, email, password_hash, name, google_id, avatar_url, role, created_at) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run("u1", "t@t.io", "test", "T", null, null, "user", now);
	await d1
		.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)")
		.run("s1", "u1", "S", "example.com", now);
	await d1
		.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, created_at) VALUES (?,?,?,?,?,?,?)",
		)
		.run(generateId(), "u1", await hashToken(token), token.slice(0, 8), "test", "session", now);
	return { token, siteId: "s1" };
}

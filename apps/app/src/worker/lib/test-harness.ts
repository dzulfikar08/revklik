import { Database } from "bun:sqlite";
import { generateId, hashToken } from "../utils";

export interface D1Like {
	__db: Database;
	prepare: (sql: string) => {
		bind: (...params: unknown[]) => {
			all: () => Promise<{ results: unknown[] }>;
			first: () => Promise<unknown>;
			run: () => Promise<unknown>;
		};
		run: (...params: unknown[]) => Promise<unknown>;
		all: () => Promise<{ results: unknown[] }>;
		first: () => Promise<unknown>;
	};
	batch: (stmts: Array<{ run: () => Promise<unknown> }>) => Promise<unknown[]>;
}

/** D1 refuses a statement with more bound parameters than this; bun:sqlite allows far more. */
const D1_MAX_BOUND_PARAMS = 100;

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
				bind: (...params: unknown[]) => {
					if (params.length > D1_MAX_BOUND_PARAMS) {
						throw new Error(
							`D1_ERROR: too many SQL variables (${params.length} > ${D1_MAX_BOUND_PARAMS}): SQLITE_ERROR`,
						);
					}
					return {
						all: async () => ({ results: get().all(...(params as never[])) }),
						first: async () => get().get(...(params as never[])) ?? null,
						run: async () => {
							get().run(...(params as never[]));
							return { success: true };
						},
					};
				},
				run: async (...params: unknown[]) => {
					get().run(...(params as never[]));
					return { success: true };
				},
				all: async () => ({ results: get().all() }),
				first: async () => get().get() ?? null,
			};
		},
		// One result per statement, like D1; `all` also surfaces RETURNING rows.
		async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
			const results: Array<{ results: unknown[] }> = [];
			for (const s of stmts) {
				const withAll = s as { all?: () => Promise<{ results: unknown[] }> };
				if (withAll.all) {
					results.push(await withAll.all());
				} else {
					await s.run();
					results.push({ results: [] });
				}
			}
			return results;
		},
	};
}

/** Minimal tables for route-level tests that skip the full migrateDatabase run. */
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

const pendingWaitUntil = new Set<Promise<unknown>>();

/** Resolves once every promise handed to testExecCtx.waitUntil has settled. */
export async function settleWaitUntil(): Promise<void> {
	while (pendingWaitUntil.size > 0) await Promise.all(pendingWaitUntil);
}

export const testExecCtx = {
	waitUntil: (p: Promise<unknown>) => {
		const settled = p.catch(() => {});
		pendingWaitUntil.add(settled);
		void settled.finally(() => pendingWaitUntil.delete(settled));
	},
	passThroughOnException: () => {},
	abort: () => {},
	props: {},
};

export interface SeedUserOptions {
	id: string;
	email?: string;
	role?: string;
	plan?: string;
	status?: string;
	periodEnd?: string;
	withSite?: string;
}

export interface MigratedTestApp {
	db: Database;
	d1: D1Database;
	env: Record<string, unknown>;
	call: (
		method: string,
		path: string,
		opts?: { token?: string; body?: unknown; headers?: Record<string, string> },
	) => Promise<Response>;
	/** Inserts user (+ subscription, + site) and returns a kp_ session token. */
	seedUser: (opts: SeedUserOptions) => Promise<string>;
}

/** Fully migrated in-memory DB behind the real app; envExtras merge into bindings. */
export async function createMigratedTestApp(
	envExtras: Record<string, unknown> = {},
): Promise<MigratedTestApp> {
	const { createApp } = await import("../app");
	const { migrateDatabase } = await import("../migrations");
	// Workers' edge cache: always miss so every request reaches the handler.
	(globalThis as { caches?: unknown }).caches ??= {
		default: { match: async () => undefined, put: async () => {} },
	};
	const db = new Database(":memory:");
	const d1 = makeD1(db) as unknown as D1Database;
	await migrateDatabase(d1);
	const app = createApp();
	const env: Record<string, unknown> = {
		DB: d1,
		ASSETS: { fetch: async () => new Response("nf", { status: 404 }) },
		...envExtras,
	};
	const call: MigratedTestApp["call"] = async (method, path, opts = {}) => {
		const headers: Record<string, string> = { ...opts.headers };
		if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
		let body: string | undefined;
		if (opts.body !== undefined) {
			body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
			headers["content-type"] ??= "application/json";
		}
		const init: RequestInit = { method, headers };
		if (body !== undefined) init.body = body;
		return app.fetch(new Request(`http://local${path}`, init), env, testExecCtx as never);
	};
	const seedUser: MigratedTestApp["seedUser"] = async (o) => {
		const now = new Date().toISOString();
		db.prepare(
			"INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?,?,?,?,?,?)",
		).run(o.id, o.email ?? `${o.id}@example.com`, "x", o.id, o.role ?? "user", now);
		if (o.plan) {
			db.prepare(
				"INSERT INTO subscriptions (id, user_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
			).run(
				`sub-${o.id}`,
				o.id,
				o.plan,
				o.status ?? "active",
				now,
				o.periodEnd ?? new Date(Date.now() + 20 * 86_400_000).toISOString(),
				now,
				now,
			);
		}
		if (o.withSite) {
			db.prepare(
				"INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)",
			).run(o.withSite, o.id, o.withSite, `${o.withSite}.example.com`, now);
		}
		const token = `kp_test_${generateId()}`;
		db.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, created_at) VALUES (?,?,?,?,?,?,?)",
		).run(generateId(), o.id, await hashToken(token), token.slice(0, 8), "test", "session", now);
		return token;
	};
	return { db, d1, env, call, seedUser };
}

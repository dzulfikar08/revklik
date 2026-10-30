import { createMigratedTestApp, type MigratedTestApp } from "../test-harness";

const encoder = new TextEncoder();

/** Hex HMAC of `message`, the primitive every signed provider uses. */
export async function hmacHex(
	secret: string,
	message: string,
	hash: "SHA-256" | "SHA-512" = "SHA-256",
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SITE = "s-wh";

/** Migrated app with one user, one site and an enabled provider row holding `config`. */
export async function setupProvider(
	provider: string,
	config: Record<string, string>,
	extraEnv: Record<string, unknown> = {},
): Promise<MigratedTestApp> {
	const t = await createMigratedTestApp(extraEnv);
	await t.seedUser({ id: "u-wh", withSite: SITE });
	t.db
		.prepare(
			"INSERT INTO payment_providers (id, site_id, provider, config, enabled) VALUES (?,?,?,?,1)",
		)
		.run(`pp-${provider}`, SITE, provider, JSON.stringify(config));
	return t;
}

export interface BookedRow {
	external_id: string | null;
	event_type: string;
	revenue: number;
	currency: string;
	rail: string | null;
	excluded_reason: string | null;
	fx_rate: number | null;
	fx_status: string | null;
	visitor_id: string;
	payment_method: string | null;
	timestamp: string;
}

/** Stored revenue rows (sales and refunds), oldest key first. */
export function booked(t: MigratedTestApp, site = SITE): BookedRow[] {
	return t.db
		.query(
			`SELECT external_id, event_type, revenue, currency, rail, excluded_reason, fx_rate, fx_status,
			        visitor_id, payment_method, timestamp
			 FROM events WHERE site_id = ? AND revenue != 0 ORDER BY external_id`,
		)
		.all(site) as BookedRow[];
}

/** Sum of revenue that reads count (test rows excluded). */
export function countedRevenue(t: MigratedTestApp, site = SITE): number {
	return booked(t, site)
		.filter((r) => !r.excluded_reason)
		.reduce((sum, r) => sum + r.revenue, 0);
}

/**
 * Make the next `failures` inserts into `events` throw like a D1 outage, then work again.
 * Returns how many failures are still pending.
 */
export function failEventInsertsOnce(t: MigratedTestApp, failures = 1): () => number {
	const real = t.env.DB as D1Database;
	let left = failures;
	t.env.DB = {
		...real,
		prepare(sql: string) {
			if (left > 0 && /insert into "events"/i.test(sql)) {
				left -= 1;
				throw new Error("D1_ERROR: transient failure");
			}
			return real.prepare(sql);
		},
	} as unknown as D1Database;
	return () => left;
}

export const quiet = <T>(fn: () => Promise<T>): Promise<T> => {
	const original = console.error;
	console.error = () => undefined;
	return fn().finally(() => {
		console.error = original;
	});
};

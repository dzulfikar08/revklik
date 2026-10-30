import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import { scrubLegacyFingerprints } from "./purge";
import { makeD1 } from "./test-harness";
import {
	clearSaltCache,
	getSiteSalt,
	SALTED_FINGERPRINT_PREFIX,
	siteFingerprint,
} from "./visitor-hash";

const IP = "203.0.113.77";

const request = (ip = IP) =>
	new Request("https://app.example/api/track", {
		headers: {
			"cf-connecting-ip": ip,
			"user-agent": "Mozilla/5.0 Test",
			"accept-language": "id-ID",
		},
	});

/** What every row carried before per-site salting: SHA-256 of ip|ua|lang|screen. */
async function legacyDigest(ip = IP, screen = ""): Promise<string> {
	const input = `${ip}|Mozilla/5.0 Test|id-ID|${screen}`;
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function migratedDb() {
	const db = new Database(":memory:");
	await migrateDatabase(makeD1(db) as unknown as D1Database);
	return db;
}

const addSite = (db: Database, id: string, excluded?: string[]) =>
	db
		.prepare(
			"INSERT INTO sites (id, user_id, name, domain, excluded_fingerprints) VALUES (?, 'u1', ?, ?, ?)",
		)
		.run(id, id, `${id}.example.com`, excluded ? JSON.stringify(excluded) : null);

beforeEach(() => clearSaltCache());

describe("per-site fingerprint", () => {
	it("gives the same device unrelated values on two sites and a stable value on one", async () => {
		const db = await migratedDb();
		addSite(db, "site-a");
		addSite(db, "site-b");
		const kysely = createDb(makeD1(db) as unknown as D1Database);

		const a1 = await siteFingerprint(kysely, "site-a", request());
		const a2 = await siteFingerprint(kysely, "site-a", request());
		const b = await siteFingerprint(kysely, "site-b", request());
		expect(a1).toBe(a2);
		expect(a1).not.toBe(b);
		expect(a1?.startsWith(SALTED_FINGERPRINT_PREFIX)).toBe(true);
		expect(await siteFingerprint(kysely, "site-a", request("198.51.100.2"))).not.toBe(a1);
		// Neither the raw IP nor the legacy bare digest can be read back out of the value.
		expect(a1).not.toContain(IP);
		expect(a1).not.toContain((await legacyDigest()).slice(0, 16));
	});

	it("mints one secret salt per site, persists it, and returns null for an unknown site", async () => {
		const db = await migratedDb();
		addSite(db, "site-a");
		addSite(db, "site-b");
		const kysely = createDb(makeD1(db) as unknown as D1Database);

		const saltA = await getSiteSalt(kysely, "site-a");
		const saltB = await getSiteSalt(kysely, "site-b");
		expect(saltA).toMatch(/^[0-9a-f]{64}$/);
		expect(saltA).not.toBe(saltB);
		clearSaltCache();
		expect(await getSiteSalt(kysely, "site-a")).toBe(saltA);
		expect(await siteFingerprint(kysely, "no-such-site", request())).toBeNull();
	});
});

describe("schema v25: salting existing data", () => {
	it("re-keys a self-traffic blocklist and its rows so a blocked device stays blocked", async () => {
		const db = await migratedDb();
		const legacy = await legacyDigest();
		const other = await legacyDigest("198.51.100.9");
		addSite(db, "site-a", [legacy]);
		db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, path, fingerprint) VALUES ('e-own','site-a','s','v','/',?), ('e-other','site-a','s2','v2','/',?)",
		).run(legacy, other);
		db.prepare("UPDATE sites SET visitor_salt = NULL").run();
		// Pretend the database predates the salt column's data step.
		db.prepare("UPDATE schema_version SET version = 24").run();

		await migrateDatabase(makeD1(db) as unknown as D1Database);

		const kysely = createDb(makeD1(db) as unknown as D1Database);
		const now = await siteFingerprint(kysely, "site-a", request());
		const site = db.query("SELECT excluded_fingerprints, visitor_salt FROM sites").get() as {
			excluded_fingerprints: string;
			visitor_salt: string;
		};
		expect(site.visitor_salt).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.parse(site.excluded_fingerprints)).toEqual([now]);
		const rows = db.query("SELECT id, fingerprint FROM events ORDER BY id").all() as {
			id: string;
			fingerprint: string;
		}[];
		expect(rows.find((r) => r.id === "e-own")?.fingerprint).toBe(now ?? "");
		// Fingerprints nobody asked to keep are left for the scrub job, not guessed at.
		expect(rows.find((r) => r.id === "e-other")?.fingerprint).toBe(other);
	});
});

describe("scrubLegacyFingerprints", () => {
	it("blanks bare digests on events, sessions and profiles, keeps salted ones, then stays done", async () => {
		const db = await migratedDb();
		const salted = `${SALTED_FINGERPRINT_PREFIX}${"a".repeat(32)}`;
		const legacy = await legacyDigest();
		db.exec(`
			INSERT INTO events (id, site_id, session_id, visitor_id, path, fingerprint) VALUES
				('e1','s','x','v','/','${legacy}'), ('e2','s','x','v','/','${salted}'), ('e3','s','x','v','/',NULL);
			INSERT INTO sessions (id, site_id, visitor_id, fingerprint) VALUES ('x1','s','v','${legacy}');
			INSERT INTO visitor_profiles (id, site_id, visitor_id, fingerprint) VALUES ('p1','s','v','${legacy}');
		`);
		const d1 = makeD1(db) as unknown as D1Database;

		expect(await scrubLegacyFingerprints(d1)).toBe(3);
		const left = db.query("SELECT id, fingerprint FROM events ORDER BY id").all() as {
			id: string;
			fingerprint: string | null;
		}[];
		expect(left.map((r) => r.fingerprint)).toEqual([null, salted, null]);
		expect(
			(
				db.query("SELECT COUNT(*) AS n FROM sessions WHERE fingerprint IS NOT NULL").get() as {
					n: number;
				}
			).n,
		).toBe(0);

		// Marked done: a later legacy-looking value (not produced by any code path) is not rescanned.
		db.exec(
			"INSERT INTO events (id, site_id, session_id, visitor_id, path, fingerprint) VALUES ('e4','s','x','v','/','zz')",
		);
		expect(await scrubLegacyFingerprints(d1)).toBe(0);
	});
});

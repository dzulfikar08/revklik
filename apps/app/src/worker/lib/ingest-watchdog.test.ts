import { beforeEach, describe, expect, it } from "bun:test";
import {
	ALERT_COOLDOWN_MS,
	BASELINE_MIN_PAGEVIEWS,
	checkIngestHealth,
	type IngestWatchdogEnv,
} from "./ingest-watchdog";
import { createMigratedTestApp, type MigratedTestApp } from "./test-harness";

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const NOW = Date.parse("2026-10-29T12:15:00.000Z");

interface SentMail {
	to: string;
	from: string;
	subject: string;
	html: string;
	text?: string;
}

let t: MigratedTestApp;
let mails: SentMail[];
let env: IngestWatchdogEnv;
let seq = 0;

/** Inserts `count` pageviews ending `agoMs` before NOW, spread inside the 2h window. */
function seedPageviews(count: number, agoMs: number, type = "pageview"): void {
	const insert = t.db.prepare(
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path) VALUES (?,?,?,?,?,?,?)",
	);
	for (let i = 0; i < count; i++) {
		const at = new Date(NOW - agoMs - 60_000 - i * 1000).toISOString();
		insert.run(`e${++seq}`, "s1", "sess", "v", at, type, "/");
	}
}

/** Pageviews inside the window that ends at `atMs`. */
const seedCurrent = (n: number, atMs = NOW) => seedPageviews(n, NOW - atMs);
/** Pageviews inside the window 7 days before the one ending at `atMs`. */
const seedBaseline = (n: number, atMs = NOW) => seedPageviews(n, WEEK_MS + NOW - atMs);
const stateRows = () => t.db.prepare("SELECT key, value FROM system_state").all();

beforeEach(async () => {
	t = await createMigratedTestApp();
	await t.seedUser({ id: "u1", withSite: "s1" });
	mails = [];
	seq = 0;
	env = {
		DB: t.d1,
		SUPER_ADMIN_EMAIL: "admin@example.com",
		EMAIL: {
			send: async (msg) => {
				mails.push(msg);
			},
		},
	};
});

describe("checkIngestHealth", () => {
	it("emails the super admin once pageviews stop while last week was busy", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS + 5);
		seedPageviews(3, 3 * HOUR_MS);

		const result = await checkIngestHealth(env, NOW);

		expect(result).toEqual({ action: "alerted", current: 0, baseline: 25, sent: true });
		expect(mails).toHaveLength(1);
		expect(mails[0]?.to).toBe("admin@example.com");
		expect(mails[0]?.subject).toContain("ALERT");
		expect(mails[0]?.text).toContain("(0)");
		expect(mails[0]?.text).toContain("had 25");
		expect(mails[0]?.text).toContain("https://app.revklik.com");
		expect(mails[0]?.html).toContain('href="https://app.revklik.com"');
		expect(stateRows()).toHaveLength(1);
	});

	it("does not resend within the cooldown, then repeats an outage that outlives it", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS);
		await checkIngestHealth(env, NOW);

		const hourLater = NOW + HOUR_MS;
		const justBefore = NOW + ALERT_COOLDOWN_MS - 1;
		const expiry = NOW + ALERT_COOLDOWN_MS;
		for (const at of [hourLater, justBefore, expiry]) seedBaseline(BASELINE_MIN_PAGEVIEWS, at);

		expect((await checkIngestHealth(env, hourLater)).action).toBe("deduped");
		expect((await checkIngestHealth(env, justBefore)).action).toBe("deduped");
		expect(mails).toHaveLength(1);

		const later = await checkIngestHealth(env, expiry);
		expect(later.action).toBe("alerted");
		expect(mails).toHaveLength(2);
	});

	it("stays silent when the same window last week was quiet", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS - 1);

		const result = await checkIngestHealth(env, NOW);

		expect(result).toEqual({ action: "quiet", current: 0, baseline: BASELINE_MIN_PAGEVIEWS - 1 });
		expect(mails).toHaveLength(0);
		expect(stateRows()).toHaveLength(0);
	});

	it("stays silent while pageviews flow, and ignores non-pageview events", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS);
		seedCurrent(2);
		expect((await checkIngestHealth(env, NOW)).action).toBe("ok");

		t.db.exec("DELETE FROM events WHERE timestamp > '2026-10-29'");
		seedPageviews(10, 0, "event");
		expect((await checkIngestHealth(env, NOW)).action).toBe("alerted");
		expect(mails).toHaveLength(1);
	});

	it("announces recovery once, then re-arms for the next outage", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS);
		await checkIngestHealth(env, NOW);
		expect(mails).toHaveLength(1);

		const recoveredAt = NOW + HOUR_MS;
		seedCurrent(4, recoveredAt);
		const recovered = await checkIngestHealth(env, recoveredAt);
		expect(recovered).toMatchObject({ action: "recovered", current: 4, sent: true });
		expect(mails).toHaveLength(2);
		expect(mails[1]?.subject).toContain("recovered");
		expect(mails[1]?.to).toBe("admin@example.com");
		expect(stateRows()).toHaveLength(0);

		const healthyAt = NOW + 2 * HOUR_MS;
		seedCurrent(4, healthyAt);
		expect((await checkIngestHealth(env, healthyAt)).action).toBe("ok");
		expect(mails).toHaveLength(2);

		const secondOutage = NOW + 30 * HOUR_MS;
		seedBaseline(BASELINE_MIN_PAGEVIEWS, secondOutage);
		const again = await checkIngestHealth(env, secondOutage);
		expect(again.action).toBe("alerted");
		expect(mails).toHaveLength(3);
	});

	it("retries next run when the mail could not be sent", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS);
		env.EMAIL = {
			send: async () => {
				throw new Error("binding down");
			},
		};
		const failed = await checkIngestHealth(env, NOW);
		expect(failed).toMatchObject({ action: "alerted", sent: false });
		expect(stateRows()).toHaveLength(0);

		env.EMAIL = {
			send: async (msg) => {
				mails.push(msg);
			},
		};
		await checkIngestHealth(env, NOW + HOUR_MS);
		expect(mails).toHaveLength(1);
	});

	it("is a no-op without SUPER_ADMIN_EMAIL or on self-hosted installs", async () => {
		seedBaseline(BASELINE_MIN_PAGEVIEWS);

		const { SUPER_ADMIN_EMAIL: _omit, ...withoutAdmin } = env;
		expect(await checkIngestHealth(withoutAdmin, NOW)).toEqual({ action: "disabled" });
		expect(await checkIngestHealth({ ...env, SELF_HOSTED: "true" }, NOW)).toEqual({
			action: "disabled",
		});
		expect(mails).toHaveLength(0);
		expect(stateRows()).toHaveLength(0);
	});
});

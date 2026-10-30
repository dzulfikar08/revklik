import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { CRON_BACKUP, CRON_MAINTENANCE, jobsFor, runScheduled } from "./cron";
import { FAILURE_MAIL_COOLDOWN_MS, reportFailures, runJobs } from "./lib/cron";
import { asBucket, FakeR2 } from "./lib/fake-r2";
import { createMigratedTestApp, makeD1 } from "./lib/test-harness";
import type { Bindings } from "./types";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** Mail binding that records every message. */
function mailbox() {
	const sent: { to: string; subject: string; text?: string }[] = [];
	return { sent, binding: { send: async (msg: (typeof sent)[number]) => void sent.push(msg) } };
}

async function envWithDb(extra: Partial<Bindings> = {}) {
	const t = await createMigratedTestApp();
	return { t, env: { DB: t.d1, ...extra } as unknown as Bindings };
}

describe("runJobs", () => {
	it("runs every job even when an earlier one throws, and reports who failed", async () => {
		const ran: string[] = [];
		const quiet = spyOn(console, "error").mockImplementation(() => {});
		const outcomes = await runJobs({}, "test", [
			[
				"first",
				async () => {
					ran.push("first");
					throw new Error("boom");
				},
			],
			["second", async () => void ran.push("second")],
			[
				"third",
				async () => {
					ran.push("third");
					throw "plain string";
				},
			],
		]);
		quiet.mockRestore();

		expect(ran).toEqual(["first", "second", "third"]);
		expect(outcomes.map((o) => [o.name, o.ok])).toEqual([
			["first", false],
			["second", true],
			["third", false],
		]);
		expect(outcomes[0]?.error).toBe("boom");
		expect(outcomes[2]?.error).toBe("plain string");
	});
});

describe("failure mails", () => {
	const failing = [{ name: "backup", ok: false, ms: 5, error: "R2 unavailable <down>" }];

	it("mails SUPER_ADMIN_EMAIL once per cooldown per job, escaping the error text", async () => {
		const { t } = await envWithDb();
		const { sent, binding } = mailbox();
		const env = { DB: t.d1, EMAIL: binding, SUPER_ADMIN_EMAIL: "admin@example.com" };
		const now = Date.now();

		await reportFailures(env, "0 3 * * *", failing, now);
		await reportFailures(env, "0 3 * * *", failing, now + 60_000);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("admin@example.com");
		expect(sent[0]?.subject).toContain("backup");
		expect(sent[0]?.text).toContain("R2 unavailable");

		await reportFailures(env, "0 3 * * *", failing, now + FAILURE_MAIL_COOLDOWN_MS + 1);
		expect(sent).toHaveLength(2);
	});

	it("retries a mail that was not delivered, and stays quiet on self-hosted installs", async () => {
		const { t } = await envWithDb();
		const env = { DB: t.d1, SUPER_ADMIN_EMAIL: "admin@example.com" };
		let accept = false;
		const sent: string[] = [];
		const binding = {
			send: async (msg: { subject: string }) => {
				if (!accept) throw new Error("mail down");
				sent.push(msg.subject);
			},
		};
		await reportFailures({ ...env, EMAIL: binding }, "x", failing);
		expect(sent).toEqual([]);
		accept = true;
		await reportFailures({ ...env, EMAIL: binding }, "x", failing);
		expect(sent).toHaveLength(1);

		await reportFailures({ ...env, EMAIL: binding, SELF_HOSTED: "1" }, "x", [
			{ name: "other", ok: false, ms: 1, error: "e" },
		]);
		expect(sent).toHaveLength(1);
	});
});

describe("scheduled triggers", () => {
	it("a failing job in the nightly upkeep does not stop the retention purge or the later jobs", async () => {
		const quiet = spyOn(console, "error").mockImplementation(() => {});
		spyOn(console, "log").mockImplementation(() => {});
		const { t, env } = await envWithDb();
		await t.seedUser({ id: "u-cron", plan: "micro", withSite: "s-cron" });
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES ('old','s-cron','s','v',?,'/')",
			)
			.run(new Date(Date.now() - 200 * 86_400_000).toISOString());
		// FX refresh dies on a dead network; the Pakasir carry-over dies on a missing table.
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		t.db.exec("DROP TABLE pakasir_orders");

		const outcomes = await runScheduled(CRON_MAINTENANCE, env);
		quiet.mockRestore();

		const byName = Object.fromEntries(outcomes.map((o) => [o.name, o.ok]));
		expect(byName["pakasir-carry-over"]).toBe(false);
		expect(byName["retention-purge"]).toBe(true);
		expect(byName["fingerprint-scrub"]).toBe(true);
		expect(byName["push-outbox-prune"]).toBe(true);
		expect(t.db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });
	});

	it("the backup runs alone in its trigger, so a failed dump cannot skip the upkeep", async () => {
		const { env } = await envWithDb({ BACKUP_BUCKET: asBucket(new FakeR2()) });
		expect(jobsFor(CRON_BACKUP, env).map(([name]) => name)).toEqual(["backup"]);
		expect(jobsFor(CRON_MAINTENANCE, env).map(([name]) => name)).not.toContain("backup");
		const quiet = spyOn(console, "error").mockImplementation(() => {});
		const outcomes = await runScheduled(CRON_BACKUP, env);
		quiet.mockRestore();
		// No BACKUP_ENCRYPTION_KEY in this env: the job fails loudly instead of writing plaintext.
		expect(outcomes).toEqual([
			expect.objectContaining({ name: "backup", ok: false, error: expect.stringContaining("KEY") }),
		]);
	});

	it("unknown triggers and a missing DB run nothing", async () => {
		expect(
			jobsFor("* * * * 9", { DB: makeD1(new Database(":memory:")) } as unknown as Bindings),
		).toEqual([]);
		expect(jobsFor(CRON_MAINTENANCE, {} as Bindings)).toEqual([]);
	});
});

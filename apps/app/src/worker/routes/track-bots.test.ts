import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import { createDb } from "../db";
import { createMigratedTestApp, testExecCtx, type MigratedTestApp } from "../lib/test-harness";
import { getOverviewStats } from "../queries/analytics";

const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface Payload {
	sid: string;
	vid: string;
	t?: "p" | "e";
	n?: string;
	ts: number;
	wd?: 1;
}

/** POST /api/track as a browser would, with the Cloudflare `cf` object Workers attach. */
async function track(t: MigratedTestApp, cf: Record<string, unknown>, events: Payload[]) {
	const req = new Request("https://example.com/api/track", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"user-agent": CHROME_UA,
			"cf-connecting-ip": "203.0.113.9",
		},
		body: JSON.stringify(
			events.map((e) => ({ s: "s-bot", t: "p", p: "/", h: "example.com", ...e })),
		),
	});
	Object.defineProperty(req, "cf", { value: cf, enumerable: true });
	const res = await createApp().fetch(req, t.env, testExecCtx as never);
	expect(res.status).toBe(202);
}

async function setup() {
	const t = await createMigratedTestApp();
	await t.seedUser({ id: "u-bot", withSite: "s-bot" });
	return t;
}

const dayAgo = () => Date.now() - 3 * 3_600_000;

describe("POST /track bot flagging", () => {
	it("stores automation flagged and keeps it out of analytics", async () => {
		const t = await setup();
		const base = dayAgo();
		await track(t, { country: "SG", city: "Singapore", asOrganization: "Some ISP" }, [
			{ sid: "bot-1", vid: "bot-v", ts: base, wd: 1 },
			{ sid: "bot-1", vid: "bot-v", t: "e", n: "scroll", ts: base + 5, wd: 1 },
		]);
		await track(t, { country: "ID", city: "Surabaya", asOrganization: "Telkom" }, [
			{ sid: "human-1", vid: "human-v", ts: base },
			{ sid: "human-1", vid: "human-v", t: "e", n: "click", ts: base + 20_000 },
		]);

		expect(t.db.query("SELECT id, is_bot, bot_reason FROM sessions ORDER BY id").all()).toEqual([
			{ id: "bot-1", is_bot: 1, bot_reason: "webdriver" },
			{ id: "human-1", is_bot: 0, bot_reason: null },
		]);
		expect(t.db.query("SELECT COUNT(*) AS n FROM events WHERE is_bot = 1").get()).toEqual({ n: 2 });

		const stats = await getOverviewStats(
			createDb(t.d1),
			"s-bot",
			new Date(base - 1000).toISOString(),
		);
		expect(stats.visitors).toBe(1);
		expect(stats.sessions).toBe(1);
		expect(stats.pageviews).toBe(1);
	});

	it("flags datacenter cities at ingest", async () => {
		const t = await setup();
		await track(t, { country: "US", city: "Ashburn", asOrganization: "Some ISP" }, [
			{ sid: "dc-1", vid: "dc-v", ts: dayAgo() },
		]);
		expect(t.db.query("SELECT is_bot, bot_reason FROM sessions WHERE id = 'dc-1'").get()).toEqual({
			is_bot: 1,
			bot_reason: "datacenter_city",
		});
	});

	it("counts each idle gap up to 30 minutes of session duration", async () => {
		const t = await setup();
		const base = dayAgo();
		const cf = { country: "ID", city: "Surabaya", asOrganization: "Telkom" };
		await track(t, cf, [{ sid: "idle-1", vid: "idle-v", ts: base }]);
		// Two hours of silence (tab left open), then ten seconds of reading.
		await track(t, cf, [
			{ sid: "idle-1", vid: "idle-v", t: "e", n: "click", ts: base + 2 * 3_600_000 },
		]);
		await track(t, cf, [
			{ sid: "idle-1", vid: "idle-v", t: "e", n: "click", ts: base + 2 * 3_600_000 + 10_000 },
		]);

		expect(
			t.db.query("SELECT active_seconds AS s FROM sessions WHERE id = 'idle-1'").get(),
		).toEqual({
			s: 1810,
		});
		const stats = await getOverviewStats(
			createDb(t.d1),
			"s-bot",
			new Date(base - 1000).toISOString(),
		);
		expect(stats.avgDuration).toBe(1810);
	});
});

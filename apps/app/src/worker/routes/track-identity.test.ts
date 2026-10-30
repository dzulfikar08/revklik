import { describe, expect, it } from "bun:test";
import { resolveVisitorId } from "../lib/visitor-identity";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const SITE = "s-id";

async function setup() {
	const t = await createMigratedTestApp();
	await t.seedUser({ id: "u-id", plan: "growth", withSite: SITE });
	return t;
}

const track = (t: MigratedTestApp, ...events: Record<string, unknown>[]) =>
	t.call("POST", "/api/track", {
		headers: { "user-agent": BROWSER_UA, "cf-connecting-ip": "203.0.113.9" },
		body: events.map((e) => ({ s: SITE, t: "p", p: "/", sr: "390x844", ...e })),
	});

const profile = (t: MigratedTestApp, vid: string) =>
	t.db
		.query("SELECT total_sessions, total_pageviews FROM visitor_profiles WHERE visitor_id = ?")
		.get(vid) as { total_sessions: number; total_pageviews: number } | null;

describe("visitor identity", () => {
	it("keeps two visitors apart when they share an IP, browser and screen", async () => {
		const t = await setup();
		// Same request headers and screen = same fingerprint: a carrier NAT, an office.
		const first = await track(t, { sid: "sid-1", vid: "vid-aaaaaaaa" });
		const second = await track(t, { sid: "sid-2", vid: "vid-bbbbbbbb" });
		expect(first.status).toBe(202);
		expect(second.status).toBe(202);

		const ids = t.db
			.query("SELECT DISTINCT visitor_id FROM events WHERE site_id = ? ORDER BY visitor_id")
			.all(SITE) as { visitor_id: string }[];
		expect(ids.map((r) => r.visitor_id)).toEqual(["vid-aaaaaaaa", "vid-bbbbbbbb"]);
		expect(profile(t, "vid-aaaaaaaa")?.total_sessions).toBe(1);
		expect(profile(t, "vid-bbbbbbbb")?.total_sessions).toBe(1);
		// The client keeps its own id: the server no longer hands back a merged one.
		const body: { success: boolean; vid?: string } = await second.json();
		expect(body.vid).toBeUndefined();
	});

	it("falls back to a fingerprint-derived visitor only when the client sends no usable id", async () => {
		const t = await setup();
		await track(t, { sid: "sid-1", vid: undefined });
		await track(t, { sid: "sid-2", vid: "not a valid id!" });
		const ids = t.db.query("SELECT DISTINCT visitor_id FROM events").all() as {
			visitor_id: string;
		}[];
		expect(ids).toHaveLength(1);
		expect(ids[0]?.visitor_id.startsWith("fp_")).toBe(true);
	});

	it("derives the same anonymous id for the same fingerprint and never for a client id", () => {
		const fp = "a".repeat(64);
		expect(resolveVisitorId(undefined, fp)).toBe(resolveVisitorId("", fp));
		expect(resolveVisitorId("client-id-1", fp)).toBe("client-id-1");
		expect(resolveVisitorId(undefined, null)).toBeNull();
	});
});

describe("visitor session counter", () => {
	it("counts a session once however many batches and events it spans", async () => {
		const t = await setup();
		await track(
			t,
			{ sid: "sid-1", vid: "vid-aaaaaaaa" },
			{ sid: "sid-1", vid: "vid-aaaaaaaa", t: "e", n: "scroll" },
		);
		await track(t, { sid: "sid-1", vid: "vid-aaaaaaaa", p: "/pricing" });
		await track(t, { sid: "sid-1", vid: "vid-aaaaaaaa", t: "e", n: "heartbeat" });
		expect(profile(t, "vid-aaaaaaaa")).toEqual({ total_sessions: 1, total_pageviews: 2 });

		await track(t, { sid: "sid-2", vid: "vid-aaaaaaaa" });
		expect(profile(t, "vid-aaaaaaaa")?.total_sessions).toBe(2);

		const real = t.db
			.query("SELECT COUNT(*) AS n FROM sessions WHERE visitor_id = 'vid-aaaaaaaa'")
			.get() as { n: number };
		expect(real.n).toBe(2);
	});
});

import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, settleWaitUntil } from "../lib/test-harness";

/** Cache API stand-in that really stores, keyed by URL. */
function installStoringCache(): void {
	const store = new Map<string, Response>();
	(globalThis as { caches?: unknown }).caches = {
		default: {
			match: async (req: Request) => store.get(req.url)?.clone(),
			put: async (req: Request, res: Response) => {
				store.set(req.url, res.clone());
			},
		},
	};
}

describe("edgeCache access re-check", () => {
	it("404s a revoked team member instead of serving the cached 200", async () => {
		installStoringCache();
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "owner", plan: "pro", withSite: "s1" });
		const memberToken = await t.seedUser({ id: "member", plan: "pro" });
		const now = new Date().toISOString();
		t.db
			.prepare(
				"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES (?,?,?,?,?,?,?)",
			)
			.run("tm1", "s1", "member", "viewer", "owner", now, now);

		const path = "/api/analytics/sparkline?site_id=s1";
		const first = await t.call("GET", path, { token: memberToken });
		expect(first.status).toBe(200);
		await settleWaitUntil();
		const second = await t.call("GET", path, { token: memberToken });
		expect(second.status).toBe(200);
		expect(second.headers.get("X-Cache")).toBe("HIT");

		t.db.prepare("DELETE FROM team_members WHERE id = 'tm1'").run();
		const revoked = await t.call("GET", path, { token: memberToken });
		expect(revoked.status).toBe(404);
	});
});

import { afterEach, describe, expect, it } from "bun:test";
import { RevKlik } from "../../../../../../packages/sdk/src/index";
import { createMigratedTestApp } from "../../lib/test-harness";
import { generateId, hashToken } from "../../utils";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** The SDK talks to the real v1 routes: its fetch is wired into the app under test. */
async function sdkAgainstApp() {
	const t = await createMigratedTestApp();
	await t.seedUser({ id: "u-sdk", plan: "growth", withSite: "s-sdk" });
	const token = `rvt_${generateId().replaceAll("-", "")}`;
	t.db
		.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes) VALUES (?,?,?,?,?,?,?)",
		)
		.run(
			generateId(),
			"u-sdk",
			await hashToken(token),
			token.slice(0, 8),
			"sdk",
			"account",
			JSON.stringify(["analytics:read", "analytics:export"]),
		);
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path) VALUES ('e1','s-sdk','x','v1',?, 'pageview','/pricing')",
		)
		.run(new Date(Date.now() - 3_600_000).toISOString());
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		return t.call(init?.method ?? "GET", `${url.pathname}${url.search}`, { headers });
	}) as typeof fetch;
	return new RevKlik({ token, baseUrl: "http://local" });
}

describe("SDK against the v1 routes", () => {
	it("export() with its default arguments returns the CSV text instead of failing to parse it", async () => {
		const rv = await sdkAgainstApp();

		const csv = await rv.analytics.export("s-sdk", "7d");

		expect(typeof csv).toBe("string");
		expect(csv.split("\n")[0]).toContain("path");
		expect(csv).toContain("/pricing");
	});

	it('export() with format "json" returns the parsed rows', async () => {
		const rv = await sdkAgainstApp();

		const rows = await rv.analytics.export("s-sdk", "7d", { format: "json" });

		expect(Array.isArray(rows)).toBe(true);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ path: "/pricing" });
	});

	it("still raises RevKlikError for an API error returned as JSON", async () => {
		const rv = await sdkAgainstApp();

		await expect(rv.analytics.export("not-my-site", "7d")).rejects.toMatchObject({
			name: "RevKlikError",
		});
	});
});

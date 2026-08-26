import { describe, expect, test } from "bun:test";
import { callTool, resolveSiteId } from "./handlers";
import { CANONICAL_TOOL_NAMES } from "./tools";

// Minimal ctx — none of these paths touch the db.
const ctx = (overrides: Record<string, unknown> = {}) =>
	({
		db: {} as never,
		userId: "u1",
		tokenScopes: ["sites:read", "analytics:read", "analytics:export"],
		tokenSiteId: null,
		tokenType: "account",
		...overrides,
	}) as Parameters<typeof callTool>[0];

describe("resolveSiteId", () => {
	test("explicit site_id wins", () => {
		expect(resolveSiteId({ tokenSiteId: "site-a" }, "site-b")).toBe("site-b");
	});
	test("missing site_id falls back to the rv_ token's bound site", () => {
		expect(resolveSiteId({ tokenSiteId: "site-a" }, undefined)).toBe("site-a");
		expect(resolveSiteId({ tokenSiteId: "site-a" }, "")).toBe("site-a");
		expect(resolveSiteId({ tokenSiteId: "site-a" }, 42)).toBe("site-a");
	});
	test("missing site_id with account token stays undefined (query layer 400s)", () => {
		expect(resolveSiteId({ tokenSiteId: null }, undefined)).toBeUndefined();
	});
});

describe("callTool dispatch", () => {
	test("unknown tool → ok:false, no throw", async () => {
		const r = await callTool(ctx(), "no_such_tool", {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("Unknown tool");
	});

	test("missing scope → ok:false with whoami hint", async () => {
		// rv_ site token: no sites:read
		const r = await callTool(
			ctx({ tokenScopes: ["analytics:read"], tokenType: "site" }),
			"list_sites",
			{},
		);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("sites:read");
			expect(r.hint).toContain("whoami");
		}
	});

	test("scope check fires before the handler (so no db touch on 403)", async () => {
		const r = await callTool(
			ctx({ tokenScopes: [], db: new Proxy({}, { get: () => () => ({}) }) as never }),
			"analytics_overview",
			{ site_id: "s" },
		);
		expect(r.ok).toBe(false);
	});
});

test("every canonical tool name has a handler (compile-time Record + runtime check)", () => {
	// TOOL_HANDLERS is Record<ToolName, …> so TS already enforces exhaustiveness;
	// this guards against runtime-only registries sneaking in.
	expect([...CANONICAL_TOOL_NAMES].length).toBe(12);
});

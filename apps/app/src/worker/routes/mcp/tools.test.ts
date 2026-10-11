import { describe, expect, test } from "bun:test";
import { CANONICAL_TOOL_NAMES, TOOL_DEFS } from "./tools";

/**
 * Drift guard (opexmx CANONICAL_TOOL_NAMES precedent): the registry is the
 * contract. Adding/removing/renaming a tool must be a deliberate change to
 * this list, never an accidental side effect.
 */
describe("tool registry", () => {
	test("registry matches CANONICAL_TOOL_NAMES exactly, in order", () => {
		expect(TOOL_DEFS.map((d) => d.name)).toEqual([...CANONICAL_TOOL_NAMES]);
		expect(TOOL_DEFS).toHaveLength(13);
	});

	test("all tool names are snake_case", () => {
		for (const name of CANONICAL_TOOL_NAMES) {
			expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	// GSC routes live under /api/gsc/* (they predate the v1 API); everything
	// else is /api/v1/*. The invariant is "documents its backing REST route".
	test("every description documents its backing REST route", () => {
		for (const def of TOOL_DEFS) {
			expect(def.description).toContain("REST: GET /api/");
		}
	});

	test("inputSchema is a JSON object schema", () => {
		for (const def of TOOL_DEFS) {
			expect(def.inputSchema.type).toBe("object");
			expect(typeof def.inputSchema.properties).toBe("object");
		}
	});

	test("site_id is required exactly for the 11 site-scoped analytics tools", () => {
		const required: string[] = TOOL_DEFS.filter((d) => d.inputSchema.required?.includes("site_id"))
			.map((d) => d.name)
			.sort();
		const expected: string[] = [
			"analytics_overview",
			"analytics_timeseries",
			"campaigns",
			"device_breakdown",
			"export_events",
			"geo_breakdown",
			"gsc_queries",
			"revenue_breakdown",
			"top_pages",
			"top_referrers",
			"visitor_journeys",
		];
		expect(required).toEqual(expected);
	});

	test("range defaults to 7d (30d for export) with sane enum", () => {
		for (const def of TOOL_DEFS) {
			const range = def.inputSchema.properties.range as { default?: string } | undefined;
			if (!range) continue;
			const expectedDefault = def.name === "export_events" ? "30d" : "7d";
			expect(range.default).toBe(expectedDefault);
		}
	});
});

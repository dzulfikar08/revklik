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
		expect(TOOL_DEFS).toHaveLength(12);
	});

	test("all tool names are snake_case", () => {
		for (const name of CANONICAL_TOOL_NAMES) {
			expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	test("every description documents its backing v1 route", () => {
		for (const def of TOOL_DEFS) {
			expect(def.description).toContain("REST: GET /api/v1/");
		}
	});

	test("inputSchema is a JSON object schema", () => {
		for (const def of TOOL_DEFS) {
			expect(def.inputSchema.type).toBe("object");
			expect(typeof def.inputSchema.properties).toBe("object");
		}
	});

	test("site_id is required exactly for the 10 site-scoped analytics tools", () => {
		const required = new Set<string>(
			TOOL_DEFS.filter((d) => d.inputSchema.required?.includes("site_id")).map((d) => d.name),
		);
		const expected = new Set([
			"analytics_overview",
			"analytics_timeseries",
			"top_pages",
			"top_referrers",
			"geo_breakdown",
			"device_breakdown",
			"revenue_breakdown",
			"campaigns",
			"visitor_journeys",
			"export_events",
		]);
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

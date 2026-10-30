import { describe, expect, it } from "vitest";

import { addFilter, isFilterOn, removeFilter, toggleFilter } from "./filter-model";

describe("click-to-filter", () => {
	it("adds an `is` filter on the first click and removes it on the second", () => {
		const on = toggleFilter([], "country", "ID");
		expect(on).toEqual([{ dimension: "country", operator: "is", value: "ID" }]);
		expect(isFilterOn(on, "country", "ID")).toBe(true);
		expect(toggleFilter(on, "country", "ID")).toEqual([]);
	});

	it("keeps other filters when one row is toggled", () => {
		const base = [{ dimension: "source", operator: "is" as const, value: "WhatsApp" }];
		const next = toggleFilter(base, "country", "ID");
		expect(next).toHaveLength(2);
		expect(toggleFilter(next, "country", "ID")).toEqual(base);
	});

	it("does not treat a different operator as the clicked row", () => {
		const base = [{ dimension: "path", operator: "contains" as const, value: "/harga" }];
		expect(isFilterOn(base, "path", "/harga")).toBe(false);
		expect(toggleFilter(base, "path", "/harga")).toHaveLength(2);
	});

	it("ignores a duplicate from the manual builder and removes by value", () => {
		const f = { dimension: "os", operator: "is" as const, value: "Android" };
		expect(addFilter([f], f)).toEqual([f]);
		expect(removeFilter([f], f)).toEqual([]);
	});
});

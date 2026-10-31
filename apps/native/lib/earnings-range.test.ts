import { describe, expect, test } from "bun:test";

import { fillDaily, presetRange } from "./earnings-range";

// 2026-10-30 18:00 UTC is already 2026-10-31 01:00 in WIB (UTC+7).
const NOW = Date.UTC(2026, 9, 30, 18, 0, 0);
const WIB = 420;

describe("presetRange", () => {
	test("today follows the local day, not the UTC day", () => {
		expect(presetRange("today", NOW, WIB)).toEqual({ from: "2026-10-31", to: "2026-10-31" });
		expect(presetRange("today", NOW, 0)).toEqual({ from: "2026-10-30", to: "2026-10-30" });
	});

	test("7d and 30d are inclusive of today", () => {
		expect(presetRange("7d", NOW, WIB)).toEqual({ from: "2026-10-25", to: "2026-10-31" });
		expect(presetRange("30d", NOW, WIB)).toEqual({ from: "2026-10-02", to: "2026-10-31" });
	});

	test("month starts on the 1st of the local month", () => {
		expect(presetRange("month", NOW, WIB)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(presetRange("month", Date.UTC(2026, 10, 30, 18, 0, 0), WIB).from).toBe("2026-12-01");
	});

	test("west of UTC reads the earlier day", () => {
		expect(presetRange("today", Date.UTC(2026, 9, 31, 3, 0, 0), -300).to).toBe("2026-10-30");
	});
});

describe("fillDaily", () => {
	test("zero-fills days the server skipped", () => {
		const out = fillDaily(
			[{ date: "2026-10-30", gross: 10, net: 9, sales: 1 }],
			"2026-10-29",
			"2026-10-31",
		);
		expect(out.map((d) => d.date)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31"]);
		expect(out[0]).toEqual({ date: "2026-10-29", gross: 0, net: 0, sales: 0 });
		expect(out[1]?.sales).toBe(1);
	});
});

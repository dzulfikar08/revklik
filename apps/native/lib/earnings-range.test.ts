import { describe, expect, test } from "bun:test";

import { fillDaily, monthGrid, pickDay, presetRange, shiftMonth } from "./earnings-range";

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

describe("custom range", () => {
	test("monthGrid starts weeks on Monday and pads both ends", () => {
		const weeks = monthGrid(2026, 11);
		// 1 Nov 2026 is a Sunday: six blanks, then the 1st.
		expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
		expect(weeks.flat().filter(Boolean)).toHaveLength(30);
		expect(weeks.at(-1)?.[0]).toBe("2026-11-30");
		expect(weeks.every((w) => w.length === 7)).toBe(true);
	});

	test("shiftMonth crosses year boundaries", () => {
		expect(shiftMonth(2026, 1, -1)).toEqual([2025, 12]);
		expect(shiftMonth(2026, 12, 1)).toEqual([2027, 1]);
		expect(shiftMonth(2026, 11, -13)).toEqual([2025, 10]);
	});

	test("pickDay: first tap starts, second tap closes in either direction", () => {
		const start = pickDay({ from: "2026-11-01", to: "2026-11-21" }, false, "2026-11-10");
		expect(start).toEqual({ pending: true, range: { from: "2026-11-10", to: "2026-11-10" } });
		expect(pickDay(start.range, true, "2026-11-15")).toEqual({
			pending: false,
			range: { from: "2026-11-10", to: "2026-11-15" },
		});
		expect(pickDay(start.range, true, "2026-11-02")).toEqual({
			pending: false,
			range: { from: "2026-11-02", to: "2026-11-10" },
		});
	});
});

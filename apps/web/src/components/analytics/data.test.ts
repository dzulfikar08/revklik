import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";

import { agoLabel, deltaBadge, duration, fmt, fmtC, money, pointLabel } from "./data";

afterEach(() => setLocale("en"));

describe("deltaBadge", () => {
	it("hides the badge when there is no previous period", () => {
		expect(deltaBadge(undefined)).toBeNull();
		expect(deltaBadge({ changePct: null, previous: 0 })).toBeNull();
		// The API sends changePct 0 for 0 -> 0; that is "no data", not "flat".
		expect(deltaBadge({ changePct: 0, previous: 0 })).toBeNull();
	});

	it("labels real changes with a signed percentage and tone", () => {
		expect(deltaBadge({ changePct: 12.34, previous: 100 })).toEqual({
			label: "+12.3%",
			tone: "good",
		});
		expect(deltaBadge({ changePct: -5, previous: 100 })).toEqual({ label: "-5.0%", tone: "bad" });
		expect(deltaBadge({ changePct: 0, previous: 40 })).toEqual({ label: "+0.0%", tone: "good" });
	});

	it("inverts the tone for metrics where lower is better", () => {
		expect(deltaBadge({ changePct: -8, previous: 50 }, true)?.tone).toBe("good");
		expect(deltaBadge({ changePct: 8, previous: 50 }, true)?.tone).toBe("bad");
	});
});

describe("money", () => {
	it("formats IDR without decimals and USD by default", () => {
		expect(money(5_504_000, "IDR").replaceAll("\u00a0", " ")).toBe("Rp 5.504.000");
		expect(money(2_000_000)).toBe("$2,000,000");
	});
});

describe("numbers and dates follow the interface language", () => {
	it("groups with dots and writes Rupiah the Indonesian way in Bahasa", () => {
		setLocale("id");
		expect(fmt(1_204)).toBe("1.204");
		expect(money(232_000, "IDR").replaceAll("\u00a0", " ")).toBe("Rp 232.000");
		expect(deltaBadge({ changePct: 12.34, previous: 100 })?.label).toBe("+12,3%");
	});

	it("keeps English grouping in English", () => {
		expect(fmt(1_204)).toBe("1,204");
		expect(fmtC(12_400)).toBe("12.4K");
	});

	it("writes month, relative time and duration in the active language", () => {
		const iso = "2026-10-23T05:00:00Z";
		setLocale("id");
		expect(pointLabel(iso, false).label).toMatch(/Okt/u);
		expect(duration(72)).toBe("1 mnt 12 dtk");
		expect(agoLabel(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 mnt lalu");
		setLocale("en");
		expect(pointLabel(iso, false).label).toMatch(/Oct/u);
		expect(duration(72)).toBe("1m 12s");
	});
});

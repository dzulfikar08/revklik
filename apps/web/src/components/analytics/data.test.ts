import { describe, expect, it } from "vitest";

import { deltaBadge, money } from "./data";

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

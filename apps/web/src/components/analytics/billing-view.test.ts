/**
 * Regressions from the audit: a grandfathered account showed "Access until
 * 1 Jan 10000" and an over-limit site count ("12 of 10") looked normal.
 */
import { describe, expect, it } from "vitest";

import { translate } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { isOpenEnded, usageLevel } from "@/lib/legacy/billing";
import type { BillingSubscription } from "@/lib/legacy/billing";

import { periodLine } from "./billing-view";

const sub = (over: Partial<BillingSubscription>): BillingSubscription => ({
	cancel_at_period_end: false,
	current_period_end: "2099-01-01T00:00:00.000Z",
	current_period_start: "2026-01-01T00:00:00.000Z",
	id: "sub-1",
	plan: "growth",
	polar_customer_id: null,
	polar_subscription_id: null,
	status: "active",
	user_id: "u1",
	...over,
});

const line = (s: BillingSubscription, locale: Locale = "en"): string =>
	periodLine(
		s,
		(key, vars) => translate(locale, key, vars),
		(iso) => iso.slice(0, 10),
	);

describe("periodLine", () => {
	it("calls a year-9999 period lifetime instead of printing a date", () => {
		const text = line(sub({ current_period_end: "9999-12-31T23:59:59.999Z" }));
		expect(text).toBe("Lifetime access");
		expect(text).not.toMatch(/\d{4}/);
		expect(line(sub({ current_period_end: "9999-12-31T23:59:59.999Z" }), "id")).toBe(
			"Akses seumur hidup",
		);
	});

	it("still shows the end date for a one-period QRIS purchase", () => {
		expect(line(sub({ current_period_end: "2099-03-05T00:00:00.000Z" }))).toBe(
			"Access until 2099-03-05",
		);
	});

	it("shows the renewal date for a card subscription", () => {
		expect(
			line(sub({ current_period_end: "2099-03-05T00:00:00.000Z", polar_subscription_id: "p1" })),
		).toBe("Renews on 2099-03-05");
	});
});

describe("isOpenEnded", () => {
	it("only treats far-future dates as open-ended", () => {
		expect(isOpenEnded("9999-12-31T23:59:59.999Z")).toBe(true);
		expect(isOpenEnded("2027-06-01T00:00:00.000Z")).toBe(false);
		expect(isOpenEnded("")).toBe(false);
		expect(isOpenEnded("not a date")).toBe(false);
	});
});

describe("usageLevel", () => {
	it("flags 12 of 10 sites as over the limit", () => {
		expect(usageLevel(12, 10)).toBe("over");
		expect(usageLevel(10, 10)).toBe("full");
		expect(usageLevel(9, 10)).toBe("near");
		expect(usageLevel(3, 10)).toBe("ok");
	});

	it("never warns when there is no limit", () => {
		expect(usageLevel(500, 0)).toBe("ok");
	});
});

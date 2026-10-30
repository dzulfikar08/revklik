import { describe, expect, it } from "vitest";

import { computeRunRate } from "./run-rate";
import type { DailyRevenue, DailyVisitors } from "./run-rate";

const day = (n: number): string => `2026-10-${String(n).padStart(2, "0")}`;

/** `days` buckets, the last being today; sales land on the given day numbers. */
const series = (days: number, sales: Record<number, number>): DailyRevenue[] =>
	Array.from({ length: days }, (_, i) => ({
		conversions: sales[i + 1] ? 1 : 0,
		date: day(i + 1),
		revenue: sales[i + 1] ?? 0,
	}));

const traffic = (days: number, from = 1): DailyVisitors[] =>
	Array.from({ length: days }, (_, i) => ({ date: day(i + 1), visitors: i + 1 >= from ? 5 : 0 }));

describe("computeRunRate", () => {
	it("averages completed days and leaves out today's partial bucket", () => {
		// 10 buckets = 9 completed days + today. Today's 900k must not count.
		const rate = computeRunRate(series(10, { 2: 90_000, 5: 90_000, 8: 90_000, 10: 900_000 }), traffic(10));
		expect(rate).toMatchObject({
			dailyAverage: 30_000,
			projected: 900_000,
			sales: 3,
			status: "ready",
			windowDays: 9,
			windowRevenue: 270_000,
		});
	});

	it("starts the window at the first tracked day, not before the site existed", () => {
		// Tracking began on day 21 of 30: 8 completed days, not 29.
		const rate = computeRunRate(series(30, { 22: 100_000, 25: 100_000, 28: 100_000 }), traffic(30, 21));
		expect(rate).toMatchObject({ status: "ready", windowDays: 9 });
		if (rate.status === "ready") {
			expect(rate.dailyAverage).toBeCloseTo(300_000 / 9);
		}
	});

	it("refuses to extrapolate from under a week of history", () => {
		const rate = computeRunRate(series(6, { 1: 50_000, 2: 50_000, 3: 50_000 }), traffic(6));
		expect(rate).toMatchObject({ reason: "too-few-days", status: "not-enough" });
	});

	it("refuses to extrapolate from one or two sales", () => {
		const rate = computeRunRate(series(15, { 3: 500_000, 9: 500_000 }), traffic(15));
		expect(rate).toMatchObject({ reason: "too-few-sales", sales: 2, status: "not-enough" });
	});

	it("reports no sales for a site with traffic but no revenue", () => {
		const rate = computeRunRate(series(15, {}), traffic(15));
		expect(rate).toMatchObject({ reason: "no-sales", status: "not-enough" });
	});

	it("handles an empty series", () => {
		expect(computeRunRate([], [])).toMatchObject({ reason: "no-sales", status: "not-enough" });
	});
});

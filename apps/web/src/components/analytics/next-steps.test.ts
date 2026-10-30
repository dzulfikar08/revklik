import { describe, expect, it } from "vitest";

import type { SiteDashboard } from "@/lib/legacy/api";

import { deriveNextSteps } from "./next-steps";

const dash = (over: Partial<SiteDashboard> = {}): SiteDashboard => ({
	browsers: [],
	channels: [],
	compare: {},
	devices: [],
	entryPagesRevenue: [],
	exitPages: [],
	journeys: [],
	os: [],
	revenueByCountry: [],
	revenueByMethod: [],
	revenueByProvider: [],
	revenueBySource: [],
	revenueTimeseries: [],
	sources: [],
	stats: {
		avgDuration: 0,
		bounceRate: 0,
		conversions: 0,
		pageviews: 10,
		revenue: 0,
		sessions: 5,
		visitors: 5,
	},
	timeseries: [],
	topPages: [],
	...over,
});

describe("deriveNextSteps", () => {
	it("asks for the snippet before anything else", () => {
		expect(deriveNextSteps(dash(), false)).toEqual([{ id: "install" }]);
	});

	it("points a site with visits and no sales at payment connections", () => {
		expect(deriveNextSteps(dash(), true)).toEqual([{ id: "connect" }]);
	});

	it("names the best source with its share of revenue", () => {
		const steps = deriveNextSteps(
			dash({
				revenueBySource: [
					{ conversions: 1, revenue: 25_000, source: "google" },
					{ conversions: 3, revenue: 75_000, source: "WhatsApp" },
				],
				stats: {
					avgDuration: 0,
					bounceRate: 0,
					conversions: 4,
					pageviews: 40,
					revenue: 100_000,
					sessions: 20,
					visitors: 20,
				},
			}),
			true,
		);
		expect(steps).toEqual([{ id: "bestSource", sales: 3, share: 75, source: "WhatsApp" }]);
	});

	it("flags a real drop and an estimated net, capped at three lines", () => {
		const steps = deriveNextSteps(
			dash({
				compare: { revenue: { changePct: -35.4, current: 65, previous: 100 } },
				entryPagesRevenue: [{ conversions: 2, path: "/harga", revenue: 65, sessions: 9 }],
				revenueBySource: [{ conversions: 2, revenue: 65, source: "direct" }],
				stats: {
					avgDuration: 0,
					bounceRate: 0,
					conversions: 2,
					netEstimated: true,
					pageviews: 40,
					revenue: 65,
					sessions: 20,
					visitors: 20,
				},
			}),
			true,
		);
		expect(steps.map((s) => s.id)).toEqual(["bestSource", "bestPage", "revenueDown"]);
		expect(steps[2]).toEqual({ id: "revenueDown", pct: 35 });
	});

	it("stays quiet for a small dip", () => {
		const steps = deriveNextSteps(
			dash({
				compare: { revenue: { changePct: -5, current: 95, previous: 100 } },
				revenueBySource: [],
				stats: {
					avgDuration: 0,
					bounceRate: 0,
					conversions: 1,
					pageviews: 40,
					revenue: 95,
					sessions: 20,
					visitors: 20,
				},
			}),
			true,
		);
		expect(steps).toEqual([]);
	});
});

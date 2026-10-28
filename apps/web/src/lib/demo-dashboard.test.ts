import { describe, expect, it } from "vitest";

import type { RangeKey } from "@/components/analytics/data";

import { buildDemoPayload, demoOnline } from "./demo-dashboard";

const NOW = new Date(2026, 9, 28, 14, 30);
const RANGES: RangeKey[] = ["24h", "7d", "30d", "90d"];
const total = (rows: { visitors: number }[]): number => rows.reduce((a, r) => a + r.visitors, 0);

describe("buildDemoPayload", () => {
	it("is deterministic", () => {
		expect(buildDemoPayload("30d", NOW)).toEqual(buildDemoPayload("30d", NOW));
	});

	it.each(RANGES)("%s: every breakdown sums to its total", (range) => {
		const { dashboard: d } = buildDemoPayload(range, NOW);
		const { stats } = d;
		expect(total(d.sources)).toBe(stats.visitors);
		expect(total(d.channels)).toBe(stats.visitors);
		expect(total(d.devices)).toBe(stats.visitors);
		expect(total(d.os)).toBe(stats.visitors);
		expect(total(d.browsers)).toBe(stats.visitors);
		expect(d.channels.reduce((a, c) => a + c.pageviews, 0)).toBe(stats.pageviews);
		expect(d.channels.reduce((a, c) => a + c.revenue, 0)).toBe(stats.revenue);
		expect(d.timeseries.reduce((a, t) => a + t.pageviews, 0)).toBe(stats.pageviews);
		expect(d.revenueTimeseries.reduce((a, t) => a + t.revenue, 0)).toBe(stats.revenue);
		expect(d.revenueTimeseries.reduce((a, t) => a + t.conversions, 0)).toBe(stats.conversions);
		expect(d.revenueBySource.reduce((a, r) => a + r.revenue, 0)).toBe(stats.revenue);
		expect(d.revenueBySource.reduce((a, r) => a + r.conversions, 0)).toBe(stats.conversions);
		expect(d.revenueByCountry.reduce((a, r) => a + r.revenue, 0)).toBe(stats.revenue);
		expect(d.revenueByCountry.reduce((a, r) => a + r.conversions, 0)).toBe(stats.conversions);
		expect(d.revenueByMethod.reduce((a, r) => a + r.revenue, 0)).toBe(stats.revenue);
		expect(d.revenueByMethod.reduce((a, r) => a + r.count, 0)).toBe(stats.conversions);
		expect(d.revenueByProvider.reduce((a, r) => a + r.revenue, 0)).toBe(stats.revenue);
		expect(d.revenueByProvider.reduce((a, r) => a + r.count, 0)).toBe(stats.conversions);
	});

	it.each(RANGES)("%s: nothing negative, pages within totals", (range) => {
		const { dashboard: d } = buildDemoPayload(range, NOW);
		const nums = [
			...Object.values(d.stats),
			...d.timeseries.flatMap((t) => [t.pageviews, t.visitors]),
			...d.revenueTimeseries.flatMap((t) => [t.revenue, t.conversions]),
		];
		expect(nums.every((n) => n >= 0)).toBe(true);
		expect(d.topPages.reduce((a, p) => a + p.pageviews, 0)).toBeLessThanOrEqual(d.stats.pageviews);
		expect(d.topPages.every((p) => p.visitors <= Math.min(p.pageviews, d.stats.visitors))).toBe(
			true,
		);
		expect(d.stats.sessions).toBeGreaterThanOrEqual(d.stats.visitors);
	});

	it("matches the shop's profile over 30 days", () => {
		const { dashboard: d } = buildDemoPayload("30d", NOW);
		expect(d.stats.visitors).toBeGreaterThan(12_000);
		expect(d.stats.visitors).toBeLessThan(20_000);
		expect(d.sources.map((s) => s.source)).toEqual(
			expect.arrayContaining(["google", "instagram", "whatsapp", "tiktok", "direct", "chatgpt"]),
		);
		expect(d.devices[0]?.device).toBe("mobile");
		expect(d.revenueByCountry[0]?.country).toBe("ID");
		expect(d.revenueByMethod[0]?.method).toBe("qris");
		expect(d.revenueByProvider.map((r) => r.provider)).toEqual(
			expect.arrayContaining(["midtrans", "xendit", "doku", "mayar"]),
		);
		expect(d.timeseries).toHaveLength(30);
	});

	it("keeps overlapping days identical across ranges", () => {
		const week = buildDemoPayload("7d", NOW).dashboard.timeseries;
		const month = buildDemoPayload("30d", NOW).dashboard.timeseries;
		expect(month.slice(-7)).toEqual(week);
	});

	it("emits 24 hourly buckets for 24h", () => {
		const { timeseries } = buildDemoPayload("24h", NOW).dashboard;
		expect(timeseries).toHaveLength(24);
		expect(timeseries.at(-1)?.date).toBe("2026-10-28T14:00:00");
	});
});

describe("demoOnline", () => {
	it("stays in a plausible band", () => {
		for (let t = 0; t < 3_600_000; t += 15_000) {
			const n = demoOnline(t);
			expect(n).toBeGreaterThanOrEqual(8);
			expect(n).toBeLessThanOrEqual(25);
		}
	});
});

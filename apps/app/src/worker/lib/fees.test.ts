import { describe, expect, it } from "bun:test";
import {
	defaultFeeRule,
	isValidReportedNet,
	netAfterRule,
	netByRefundRatio,
	normalizeRail,
	railFromSource,
	resolveProduct,
} from "./fees";

const RATES = { USD: 1, IDR: 16_000 };

describe("netAfterRule", () => {
	it("takes 15% off an Apple sale", () => {
		expect(netAfterRule(10, "USD", defaultFeeRule("apple"), RATES)).toBe(8.5);
	});

	it("adds the fixed fee, converted into the event currency", () => {
		const polar = defaultFeeRule("polar");
		expect(netAfterRule(10, "USD", polar, RATES)).toBeCloseTo(9.2, 6);
		// 4% of 100000 IDR + 0.40 USD = 6400 IDR
		expect(netAfterRule(100_000, "IDR", polar, RATES)).toBeCloseTo(89_600, 4);
	});

	it("keeps the sign and never goes below zero", () => {
		expect(netAfterRule(-10, "USD", defaultFeeRule("apple"), RATES)).toBe(-8.5);
		expect(netAfterRule(0.2, "USD", defaultFeeRule("stripe"), RATES)).toBe(0);
	});

	it("charges nothing on unknown rails", () => {
		expect(netAfterRule(12.34, "USD", defaultFeeRule("manual"), RATES)).toBe(12.34);
	});
});

describe("netByRefundRatio", () => {
	it("mirrors the sale's net/gross ratio", () => {
		expect(netByRefundRatio(-4, { revenue: 10, net_revenue: 8.5 })).toBe(-3.4);
		expect(netByRefundRatio(-10, { revenue: 10, net_revenue: 8.5 })).toBe(-8.5);
	});

	it("gives no ratio without a usable sale", () => {
		expect(netByRefundRatio(-4, undefined)).toBeNull();
		expect(netByRefundRatio(-4, { revenue: 10, net_revenue: null })).toBeNull();
		expect(netByRefundRatio(-4, { revenue: 0, net_revenue: 0 })).toBeNull();
	});
});

describe("rail and product defaults", () => {
	it("maps sources to canonical rails", () => {
		expect(railFromSource("app_store")).toBe("apple");
		expect(railFromSource("apple_iap")).toBe("apple");
		expect(railFromSource("google_play_billing")).toBe("google_play");
		expect(railFromSource("polar_webhook")).toBe("polar");
		expect(railFromSource("DOKU")).toBe("doku");
		expect(railFromSource("pakasir")).toBe("pakasir");
		expect(railFromSource("server")).toBe("server");
	});

	it("validates explicit rails", () => {
		expect(normalizeRail(" Apple ")).toBe("apple");
		expect(normalizeRail("bad rail")).toBeNull();
		expect(normalizeRail("")).toBeNull();
	});

	it("takes the product from the field, then props.product, then props.app", () => {
		expect(resolveProduct("joyorogo", { product: "x" })).toBe("joyorogo");
		expect(resolveProduct(undefined, { product: "pro", app: "waqtu" })).toBe("pro");
		expect(resolveProduct(null, { app: "waqtu" })).toBe("waqtu");
		expect(resolveProduct(null, undefined)).toBeNull();
	});
});

describe("isValidReportedNet", () => {
	it("accepts a same-sign net no larger than revenue", () => {
		expect(isValidReportedNet(10, 8.5)).toBe(true);
		expect(isValidReportedNet(10, 10)).toBe(true);
		expect(isValidReportedNet(-10, -8)).toBe(true);
		expect(isValidReportedNet(10, 0)).toBe(true);
	});

	it("rejects larger, opposite-sign and non-finite nets", () => {
		expect(isValidReportedNet(10, 10.5)).toBe(false);
		expect(isValidReportedNet(10, -1)).toBe(false);
		expect(isValidReportedNet(-10, 5)).toBe(false);
		expect(isValidReportedNet(10, Number.NaN)).toBe(false);
	});
});

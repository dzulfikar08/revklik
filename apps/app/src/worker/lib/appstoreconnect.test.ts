import { describe, expect, it } from "bun:test";
import {
	aggregateSalesRows,
	detectPriceChanges,
	parseCsv,
	parseEngagementReport,
	parseSalesReportTsv,
	priceChangeAnnotationText,
} from "./appstoreconnect";

// Sales report v1_1 SALES/SUMMARY/DAILY sample — header names and column
// order follow Apple's published format; positions are what the parser must
// not depend on.
const SALES_TSV = [
	"Provider\tProvider Country\tSKU\tDesignated SKU Supported\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tUnits\tDeveloper Proceeds Extended\tCustomer Price\tProduct Type Identifier\tApple Identifier\tVendor Identifier\tParent Identifier",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t2\t1.40\t2.99\t1\t123456789\tklikapa01\t ",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t1\t0.70\t2.99\tF1\t123456789\tklikapa01\t ",
	"RevKlik\tUS\tklikapa.pro\tY\t0.35\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t1\t0.35\t1.99\tIA1\t555000111\tklikapa.pro\tklikapa01",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/06/2026\t09/06/2026\tUSD\tDE\tUSD\t1\t0.70\t3.99\t1\t123456789\tklikapa01\t ",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/07/2026\t09/07/2026\tEUR\tDE\tUSD\t1\t0.70\t4.99\t1\t123456789\tklikapa01\t ",
	"RevKlik\tUS\tklikapa01\tY\t0\t09/07/2026\t09/07/2026\tUSD\tUS\t \t40\t0\t0\tF7\t123456789\tklikapa01\t ",
	"RevKlik\tUS\tklikapa01\tY\t0\t09/07/2026\t09/07/2026\tUSD\tUS\t \t3\t0\t0\t3F\t123456789\tklikapa01\t ",
	"RevKlik\tUS\totherapp\tY\t0.70\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t9\t6.30\t0.99\t1\t987654321\totherapp\t ",
].join("\n");

describe("parseSalesReportTsv", () => {
	it("parses units, proceeds, and prices by header name", () => {
		const rows = parseSalesReportTsv(SALES_TSV);
		expect(rows).toHaveLength(6);
		const first = rows[0];
		expect(first.date).toBe("2026-09-05");
		expect(first.country).toBe("US");
		expect(first.units).toBe(2);
		expect(first.proceeds).toBeCloseTo(1.4);
		expect(first.customerPrice).toBeCloseTo(2.99);
		expect(first.isIap).toBe(false);
		expect(first.appleId).toBe("123456789");
	});

	it("flags IAP product types and keeps their parent app SKU", () => {
		const rows = parseSalesReportTsv(SALES_TSV);
		const iap = rows.find((r) => r.proceeds === 0.35);
		expect(iap?.isIap).toBe(true);
		expect(iap?.parentSku).toBe("klikapa01");
		// A Mac app sale (F1) is a download, not an in-app purchase.
		expect(rows.filter((r) => !r.isIap && r.appleId === "123456789")).toHaveLength(4);
	});

	it("skips updates and re-downloads", () => {
		const rows = parseSalesReportTsv(SALES_TSV);
		expect(rows.some((r) => r.units === 40 || r.units === 3)).toBe(false);
	});

	it("returns empty for headerless or empty reports", () => {
		expect(parseSalesReportTsv("")).toEqual([]);
		expect(parseSalesReportTsv("Provider\tSKU\n")).toEqual([]);
	});
});

describe("aggregateSalesRows", () => {
	it("splits app vs IAP and filters by apple id and parent SKU", () => {
		const { days, countries } = aggregateSalesRows(parseSalesReportTsv(SALES_TSV), "123456789", {
			appSku: "klikapa01",
		});
		expect(days).toHaveLength(3);
		const day5 = days.find((d) => d.date === "2026-09-05");
		expect(day5?.units).toBe(3);
		expect(day5?.proceeds).toBeCloseTo(2.1);
		expect(day5?.iapUnits).toBe(1);
		expect(day5?.iapProceeds).toBeCloseTo(0.35);
		// Other app's rows must not leak in.
		expect(days.reduce((a, d) => a + d.units, 0)).toBe(5);
		const de6 = countries.find((c) => c.date === "2026-09-06" && c.country === "DE");
		expect(de6?.customerPrice).toBeCloseTo(3.99);
	});

	it("converts every storefront's proceeds to USD", () => {
		const tsv = [
			"Begin Date\tCountry Code\tUnits\tDeveloper Proceeds\tCurrency of Proceeds\tCustomer Price\tCustomer Currency\tProduct Type Identifier\tApple Identifier",
			"11/17/2026\tID\t1\t105810\tIDR\t129000\tIDR\tF1\t1",
			"11/17/2026\tUS\t1\t5.59\tUSD\t7.99\tUSD\tF1\t1",
		].join("\n");
		const { days, countries } = aggregateSalesRows(parseSalesReportTsv(tsv), "1", {
			rates: { USD: 1, IDR: 16000 },
		});
		expect(days[0]?.proceeds).toBeCloseTo(105810 / 16000 + 5.59);
		expect(days[0]?.proceedsCurrency).toBe("USD");
		// The charged price stays in the customer's currency.
		expect(countries.find((c) => c.country === "ID")?.customerPrice).toBe(129000);
	});
});

describe("detectPriceChanges", () => {
	const base = { units: 1, proceeds: 0.7 };

	it("detects tier changes and skips zero-sale days", () => {
		const changes = detectPriceChanges([
			{ date: "2026-09-01", country: "US", customerPrice: 0.99, customerCurrency: "USD", ...base },
			{ date: "2026-09-02", country: "US", customerPrice: 0.99, customerCurrency: "USD", ...base },
			{
				date: "2026-09-03",
				country: "US",
				customerPrice: null,
				customerCurrency: "USD",
				units: 0,
				proceeds: 0,
			},
			{ date: "2026-09-04", country: "US", customerPrice: 2.99, customerCurrency: "USD", ...base },
		]);
		expect(changes).toEqual([
			{ country: "US", date: "2026-09-04", from: 0.99, to: 2.99, currency: "USD" },
		]);
	});

	it("tracks countries independently and detects going free", () => {
		const changes = detectPriceChanges([
			{ date: "2026-09-01", country: "US", customerPrice: 0.99, customerCurrency: "USD", ...base },
			{ date: "2026-09-02", country: "US", customerPrice: 0, customerCurrency: "USD", ...base },
			{ date: "2026-09-01", country: "DE", customerPrice: 1.09, customerCurrency: "EUR", ...base },
			{ date: "2026-09-02", country: "DE", customerPrice: 1.09, customerCurrency: "EUR", ...base },
		]);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ country: "US", from: 0.99, to: 0 });
	});

	it("annotation text renders both prices and currency", () => {
		expect(
			priceChangeAnnotationText({
				country: "US",
				date: "2026-09-04",
				from: 0.99,
				to: 2.99,
				currency: "USD",
			}),
		).toBe("App Store price change — US: 0.99 → 2.99 USD");
	});
});

describe("parseEngagementReport", () => {
	// "App Store Discovery and Engagement Standard": tab-separated, one row per
	// date x event x page/source/device/territory slice.
	const H =
		"Date\tApp Name\tApp Apple Identifier\tEvent\tPage Type\tSource Type\tEngagement Type\tDevice\tPlatform Version\tTerritory\tCounts\tUnique Counts";
	const row = (date: string, app: string, event: string, source: string, n: number) =>
		[
			date,
			"KlikApa",
			app,
			event,
			"Product page",
			source,
			"",
			"Desktop",
			"macOS 26",
			"US",
			n,
			n,
		].join("\t");
	const TSV = [
		H,
		row("2026-11-17", "123456789", "Impression", "App Store Search", 100),
		row("2026-11-17", "123456789", "Impression", "App Store Search", 20),
		row("2026-11-17", "123456789", "Impression", "App Store Browse", 30),
		row("2026-11-17", "123456789", "Page view", "App Store Search", 8),
		row("2026-11-17", "123456789", "Tap", "App Store Search", 99),
		row("2026-11-17", "987654321", "Impression", "App Store Search", 999),
		row("2026-11-18", "123456789", "Page view", "Web referrer", 2),
	].join("\n");

	it("sums impressions and page views per day and per source, for one app only", () => {
		const rows = parseEngagementReport(TSV, "123456789");
		const get = (date: string, source: string) =>
			rows.find((r) => r.date === date && r.source === source);
		expect(get("2026-11-17", "")).toEqual({
			date: "2026-11-17",
			source: "",
			impressions: 150,
			pageViews: 8,
		});
		expect(get("2026-11-17", "App Store Search")?.impressions).toBe(120);
		expect(get("2026-11-17", "App Store Browse")?.impressions).toBe(30);
		expect(get("2026-11-18", "")?.pageViews).toBe(2);
		expect(rows).toHaveLength(5);
	});

	it("reads comma-separated files too and ignores reports without the needed columns", () => {
		const csv = TSV.replace(/\t/g, ",");
		expect(parseEngagementReport(csv, "123456789").find((r) => r.source === "")?.impressions).toBe(
			150,
		);
		expect(parseEngagementReport("Date,Foo\n2026-11-17,1", "123456789")).toEqual([]);
	});
});

describe("parseCsv", () => {
	it("handles quoted commas and newlines", () => {
		const rows = parseCsv('a,b,c\n"x,y",z,\n"multi\nline",1,2');
		expect(rows).toEqual([
			["a", "b", "c"],
			["x,y", "z", ""],
			["multi\nline", "1", "2"],
		]);
	});
});

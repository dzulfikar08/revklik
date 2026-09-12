import { describe, expect, it } from "bun:test";
import {
	aggregateSalesRows,
	detectPriceChanges,
	parseCsv,
	parseEngagementCsv,
	parseMoneyCurrency,
	parseSalesReportTsv,
	priceChangeAnnotationText,
} from "./appstoreconnect";

// Sales report v1_3 SALES/SUMMARY/DAILY sample — header names and column
// order follow Apple's published format; positions are what the parser must
// not depend on.
const SALES_TSV = [
	"Provider\tProvider Country\tSKU\tDesignated SKU Supported\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tUnits\tDeveloper Proceeds Extended\tCustomer Price\tProduct Type Identifier\tApple Identifier\tVendor Identifier",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t2\t1.40\t2.99\t1\t123456789\tklikapa01",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t1\t0.70\t2.99\t1\t123456789\tklikapa01",
	"RevKlik\tUS\tklikapa01\tY\t0.35\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t1\t0.35\t1.99\tF\t123456789\tklikapa01",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/06/2026\t09/06/2026\tUSD\tDE\tUSD\t1\t0.70\t3.99\t1\t123456789\tklikapa01",
	"RevKlik\tUS\tklikapa01\tY\t0.70\t09/07/2026\t09/07/2026\tEUR\tDE\tUSD\t1\t0.70\t4.99\t1\t123456789\tklikapa01",
	"RevKlik\tUS\totherapp\tY\t0.70\t09/05/2026\t09/05/2026\tUSD\tUS\tUSD\t9\t6.30\t0.99\t1\t987654321\totherapp",
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

	it("flags IAP product types", () => {
		const rows = parseSalesReportTsv(SALES_TSV);
		expect(rows.find((r) => r.proceeds === 0.35)?.isIap).toBe(true);
	});

	it("returns empty for headerless or empty reports", () => {
		expect(parseSalesReportTsv("")).toEqual([]);
		expect(parseSalesReportTsv("Provider\tSKU\n")).toEqual([]);
	});
});

describe("aggregateSalesRows", () => {
	it("splits app vs IAP and filters by apple id", () => {
		const { days, countries } = aggregateSalesRows(parseSalesReportTsv(SALES_TSV), "123456789");
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

describe("parseMoneyCurrency", () => {
	it("parses English and European formatting", () => {
		expect(parseMoneyCurrency("USD 1,234")).toEqual({ currency: "USD", amount: 1234 });
		expect(parseMoneyCurrency("USD 12,345.67")).toEqual({ currency: "USD", amount: 12345.67 });
		expect(parseMoneyCurrency("EUR 1.234,56")).toEqual({ currency: "EUR", amount: 1234.56 });
		expect(parseMoneyCurrency("EUR 12,34")).toEqual({ currency: "EUR", amount: 12.34 });
		expect(parseMoneyCurrency("N/A")).toBeNull();
	});
});

describe("parseEngagementCsv", () => {
	const CSV = [
		"Date,App,App Name,Impressions,Page Views,Downloads,Proceeds,Paying Users",
		'09/05/2026,123456789,"KlikApa, Inc",100,50,10,"USD 12,345",4',
		"09/05/2026,987654321,Other,999,999,999,999,999",
		"09/06/2026,123456789,KlikApa Inc,120,60,12,USD 1.234,56,5",
	].join("\n");

	it("filters by app id and sums quoted fields", () => {
		const days = parseEngagementCsv(CSV, "123456789");
		expect(days).toHaveLength(2);
		expect(days[0]).toEqual({
			date: "2026-09-05",
			impressions: 100,
			pageViews: 50,
			payingUsers: 4,
		});
		expect(days[1]?.impressions).toBe(120);
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

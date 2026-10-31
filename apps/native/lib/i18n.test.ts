import { describe, expect, test } from "bun:test";

import { money } from "./analytics-data";
import { marketingUrl, t } from "./i18n";

describe("money", () => {
	test("uses the site currency instead of a hard-coded dollar sign", () => {
		expect(money(64000, "IDR")).toContain("64.000");
		expect(money(64000, "IDR")).not.toContain("$");
		expect(money(1234.6, "EUR")).toContain("1,235");
		expect(money(5)).toContain("$");
	});

	test("an unknown ISO code falls back to USD", () => {
		expect(money(5, "???")).toContain("$");
	});
});

describe("t", () => {
	test("interpolates variables", () => {
		expect(t("dash.visitorToSaleNote", { sales: 3, visitors: 120 })).toMatch(/3.*120/u);
	});

	test("marketing links are extensionless", () => {
		expect(marketingUrl("privacy")).toMatch(/^https:\/\/revklik\.com(\/en)?\/privacy$/u);
	});
});

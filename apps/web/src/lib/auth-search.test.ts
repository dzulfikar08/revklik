import { describe, expect, it } from "vitest";

import { parseView } from "@/components/analytics/views";
import { siteHasEvents } from "@/components/analytics/snippet-modal";

import { afterAuthTarget, parseNext, validateAuthSearch } from "./auth-search";

describe("validateAuthSearch", () => {
	it.each<[Record<string, unknown>, ReturnType<typeof validateAuthSearch>]>([
		[{}, {}],
		[
			{ plan: "growth", ref: "budi" },
			{ plan: "growth", ref: "budi" },
		],
		[{ plan: "gold", ref: "bad ref!" }, {}],
		[
			{ next: "/analytics/billing?checkout=success" },
			{ next: "/analytics/billing?checkout=success" },
		],
		[{ next: "//evil.com" }, {}],
		[{ next: "https://evil.com/analytics" }, {}],
		[
			{ utm_source: "public-dashboard", utm_medium: "referral", x: 1 },
			{
				utm_medium: "referral",
				utm_source: "public-dashboard",
			},
		],
	])("%j", (input, expected) => {
		expect(validateAuthSearch(input)).toEqual(expected);
	});

	it.each([
		["/analytics", "/analytics"],
		["/analytics/abc?view=billing", "/analytics/abc?view=billing"],
		["/analyticsfoo", undefined],
		["/login", undefined],
	])("parseNext(%j) -> %j", (input, expected) => {
		expect(parseNext(input)).toBe(expected);
	});
});

describe("afterAuthTarget", () => {
	it("sends a picked plan to billing, even with a next", () => {
		expect(afterAuthTarget({ next: "/analytics/x", plan: "starter" })).toEqual({
			search: { plan: "starter" },
			to: "/analytics/billing",
		});
	});

	it("returns to next, else the sites list", () => {
		expect(afterAuthTarget({ next: "/analytics/billing?checkout=success" })).toEqual({
			href: "/analytics/billing?checkout=success",
		});
		expect(afterAuthTarget({})).toEqual({ to: "/analytics" });
	});
});

describe("parseView", () => {
	it.each([
		["billing", "billing"],
		["settings", "settings"],
		["home", "home"],
		["nope", "home"],
		[undefined, "home"],
	])("%j -> %s", (input, expected) => {
		expect(parseView(input)).toBe(expected);
	});
});

describe("siteHasEvents", () => {
	it.each([
		[{ has_events: false }, false],
		[{ has_events: true }, true],
		[{}, true],
	])("%j -> %s", (site, expected) => {
		expect(siteHasEvents(site)).toBe(expected);
	});
});

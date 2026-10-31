import { describe, expect, it } from "vitest";

import { parseView } from "@/components/analytics/views";
import { siteHasEvents } from "@/components/analytics/snippet-modal";

import { afterAuthPath, afterAuthTarget, googleAuthUrl, parseNext, validateAuthSearch } from "./auth-search";

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
		[
			{ next: "/oauth/authorize?client_id=revklik-books&state=abc" },
			{ next: "/oauth/authorize?client_id=revklik-books&state=abc" },
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
		["/oauth/authorize?state=x", "/oauth/authorize?state=x"],
		["/oauth/authorize", undefined],
		["/oauth/authorize#frag", undefined],
		["/oauth/authorize/../token?x=1", undefined],
		["/oauth/token?x=1", undefined],
		["https://evil.com/oauth/authorize?x=1", undefined],
		["//evil.com/oauth/authorize?x=1", undefined],
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

	it("returns to a Books sign-in request as a document path", () => {
		const next = "/oauth/authorize?client_id=revklik-books&state=abc";
		expect(afterAuthTarget({ next })).toEqual({ href: next });
		expect(afterAuthPath({ next })).toBe(next);
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

describe("journey ids", () => {
	const VID = "4f7c2a9e-1b3d-4c5e-8f60-123456789abc";
	const SID = "0a1b2c3d-4e5f-4a6b-9c7d-0123456789ab";

	it("keeps UUID-shaped rk_vid / rk_sid and drops the rest", () => {
		expect(validateAuthSearch({ rk_sid: SID, rk_vid: VID })).toEqual({ rk_sid: SID, rk_vid: VID });
		expect(validateAuthSearch({ rk_sid: "x", rk_vid: "<script>" })).toEqual({});
	});

	it("sends rk_vid to Google only when valid", () => {
		expect(googleAuthUrl("/api", "budi", "growth", VID)).toBe(
			`/api/auth/google?ref=budi&plan=growth&rk_vid=${VID}`,
		);
		expect(googleAuthUrl("/api", undefined, undefined, "nope")).toBe("/api/auth/google");
	});
});

describe("afterAuthPath", () => {
	it("mirrors afterAuthTarget as a path", () => {
		expect(afterAuthPath({ plan: "starter" })).toBe("/analytics/billing?plan=starter");
		expect(afterAuthPath({ next: "/analytics/x?view=billing" })).toBe("/analytics/x?view=billing");
		expect(afterAuthPath({})).toBe("/analytics");
	});
});

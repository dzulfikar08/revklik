import { beforeEach, describe, expect, it } from "vitest";

import {
	clearSignupIntent,
	parseRef,
	parseTrackerId,
	rememberVisitorId,
	rememberRef,
	rememberSignInNext,
	rememberSignupPlan,
	signupRef,
	signupVisitorId,
	storedRef,
	takeSignInNext,
	takeSignupPlan,
} from "./signup-intent";

beforeEach(() => {
	localStorage.clear();
});

describe("signup intent", () => {
	it.each([
		["budi", "budi"],
		["toko-ku_2", "toko-ku_2"],
		["", undefined],
		["has space", undefined],
		["a/../b", undefined],
		["x".repeat(65), undefined],
		[42, undefined],
	])("parseRef(%j) -> %j", (input, expected) => {
		expect(parseRef(input)).toBe(expected);
	});

	it("remembers a valid ref and ignores an invalid one", () => {
		rememberRef("budi");
		rememberRef("not valid!");
		expect(storedRef()).toBe("budi");
	});

	it("re-validates a tampered stored ref", () => {
		localStorage.setItem("kp_ref", "<script>");
		expect(storedRef()).toBeNull();
	});

	it("prefers a valid URL ref over the stored one", () => {
		rememberRef("stored");
		expect(signupRef("fromurl")).toBe("fromurl");
		expect(signupRef("bad ref")).toBe("stored");
		expect(signupRef(undefined)).toBe("stored");
	});

	it("takes the saved plan once", () => {
		rememberSignupPlan("growth");
		expect(takeSignupPlan()).toBe("growth");
		expect(takeSignupPlan()).toBeUndefined();
	});

	it("clearSignupIntent drops both ref and plan", () => {
		rememberRef("budi");
		rememberSignupPlan("starter");
		clearSignupIntent();
		expect(storedRef()).toBeNull();
		expect(takeSignupPlan()).toBeUndefined();
	});
});

describe("journey visitor id", () => {
	const VID = "4f7c2a9e-1b3d-4c5e-8f60-123456789abc";

	it.each([
		[VID, VID],
		[VID.toUpperCase(), VID],
		["not-a-uuid", undefined],
		["", undefined],
		[`${VID}x`, undefined],
		[42, undefined],
	])("parseTrackerId(%j) -> %j", (input, expected) => {
		expect(parseTrackerId(input)).toBe(expected);
	});

	it("prefers a valid URL id over the stored one and drops invalid ones", () => {
		rememberVisitorId(VID);
		expect(signupVisitorId(undefined)).toBe(VID);
		expect(signupVisitorId("1".repeat(36))).toBe(VID);
		const other = "0a1b2c3d-4e5f-4a6b-9c7d-0123456789ab";
		expect(signupVisitorId(other)).toBe(other);
		rememberVisitorId("bad");
		expect(signupVisitorId(undefined)).toBe(VID);
	});

	it("is cleared with the rest of the signup intent", () => {
		rememberVisitorId(VID);
		clearSignupIntent();
		expect(signupVisitorId(undefined)).toBeNull();
	});
});

describe("sign-in destination across the Google round trip", () => {
	const NEXT = "/oauth/authorize?client_id=revklik-books&state=abc";

	it("is read once, then gone", () => {
		rememberSignInNext(NEXT);
		expect(takeSignInNext()).toBe(NEXT);
		expect(takeSignInNext()).toBeNull();
	});

	it("is replaced by a start that has no destination", () => {
		rememberSignInNext(NEXT);
		rememberSignInNext(undefined);
		expect(takeSignInNext()).toBeNull();
	});
});

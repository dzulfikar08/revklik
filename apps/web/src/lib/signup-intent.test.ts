import { beforeEach, describe, expect, it } from "vitest";

import {
	clearSignupIntent,
	parseRef,
	rememberRef,
	rememberSignupPlan,
	signupRef,
	storedRef,
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

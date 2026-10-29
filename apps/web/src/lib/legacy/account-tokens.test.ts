import { beforeEach, describe, expect, it } from "vitest";

import {
	forgetToken,
	getRememberedToken,
	pruneTokens,
	readTokenMap,
	rememberToken,
	TOKENS_KEY,
} from "./account-tokens";

beforeEach(() => localStorage.clear());

describe("kp_tokens map", () => {
	it("starts empty and tolerates corrupt or wrongly shaped storage", () => {
		expect(readTokenMap(localStorage)).toEqual({});
		localStorage.setItem(TOKENS_KEY, "{nope");
		expect(readTokenMap(localStorage)).toEqual({});
		localStorage.setItem(TOKENS_KEY, JSON.stringify(["a"]));
		expect(readTokenMap(localStorage)).toEqual({});
		localStorage.setItem(TOKENS_KEY, JSON.stringify({ u1: 3 }));
		expect(readTokenMap(localStorage)).toEqual({});
	});

	it("remembers one token per user and overwrites on re-login", () => {
		rememberToken(localStorage, "u1", "kp_a");
		rememberToken(localStorage, "u2", "kp_b");
		rememberToken(localStorage, "u1", "kp_c");
		expect(readTokenMap(localStorage)).toEqual({ u1: "kp_c", u2: "kp_b" });
		expect(getRememberedToken(localStorage, "u2")).toBe("kp_b");
		expect(getRememberedToken(localStorage, "u3")).toBeNull();
	});

	it("forgets one user and removes the key once empty", () => {
		rememberToken(localStorage, "u1", "kp_a");
		rememberToken(localStorage, "u2", "kp_b");
		forgetToken(localStorage, "u1");
		expect(readTokenMap(localStorage)).toEqual({ u2: "kp_b" });
		forgetToken(localStorage, "u2");
		expect(localStorage.getItem(TOKENS_KEY)).toBeNull();
	});

	it("prunes tokens of accounts that are no longer linked", () => {
		rememberToken(localStorage, "me", "kp_me");
		rememberToken(localStorage, "linked", "kp_l");
		rememberToken(localStorage, "gone", "kp_g");
		pruneTokens(localStorage, ["me", "linked"]);
		expect(readTokenMap(localStorage)).toEqual({ me: "kp_me", linked: "kp_l" });
	});
});

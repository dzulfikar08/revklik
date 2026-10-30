import { afterEach, describe, expect, it, vi } from "vitest";

import { detectLocale, translate } from "./i18n";
import { MESSAGES } from "./i18n-messages";

afterEach(() => {
	localStorage.clear();
	vi.unstubAllGlobals();
	window.history.replaceState(null, "", "/");
});

describe("detectLocale", () => {
	it("prefers the stored toggle choice", () => {
		localStorage.setItem("kp_locale", "id");
		expect(detectLocale()).toBe("id");
	});

	it("takes ?lang over the stored choice and remembers it", () => {
		localStorage.setItem("kp_locale", "id");
		window.history.replaceState(null, "", "/register?lang=en");
		expect(detectLocale()).toBe("en");
		expect(localStorage.getItem("kp_locale")).toBe("en");
	});

	it("follows ?lang in the demo embed without overwriting the visitor's choice", () => {
		localStorage.setItem("kp_locale", "id");
		window.history.replaceState(null, "", "/demo?embed=1&lang=en");
		expect(detectLocale()).toBe("en");
		expect(localStorage.getItem("kp_locale")).toBe("id");
	});

	it("falls back to an Indonesian browser language", () => {
		vi.stubGlobal("navigator", { language: "id-ID" });
		expect(detectLocale()).toBe("id");
	});

	it("defaults to English", () => {
		vi.stubGlobal("navigator", { language: "en-US" });
		expect(detectLocale()).toBe("en");
	});
});

describe("translate", () => {
	it("fills placeholders", () => {
		expect(translate("id", "billing.planName", { plan: "Growth" })).toBe("Paket Growth");
	});

	it("uses the English singular only when n is 1", () => {
		expect(translate("en", "billing.trialEndsIn", { n: 1 })).toBe("Trial ends in 1 day");
		expect(translate("en", "billing.trialEndsIn", { n: 3 })).toBe("Trial ends in 3 days");
		expect(translate("id", "billing.trialEndsIn", { n: 1 })).toBe("Trial berakhir 1 hari lagi");
	});

	it("keeps the same placeholders in English and Indonesian", () => {
		const names = (text: string): string[] =>
			[...text.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).toSorted();
		const mismatched = Object.entries(MESSAGES.id)
			.filter(([key, text]) => {
				const english = MESSAGES.en[key as keyof typeof MESSAGES.en];
				return english !== undefined && names(english).join() !== names(text).join();
			})
			.map(([key]) => key);
		expect(mismatched).toEqual([]);
	});

	it("ships no em dashes in either language (antislop R-02)", () => {
		for (const dict of Object.values(MESSAGES)) {
			for (const text of Object.values(dict)) {
				expect(text).not.toContain("—");
			}
		}
	});
});

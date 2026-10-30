import { describe, expect, it } from "vitest";

import {
	authDocumentTitle,
	docsUrl,
	firstInvalidField,
	marketingUrl,
	validateAuthFields,
} from "./auth-page";
import { translate } from "./i18n";
import { MESSAGES } from "./i18n-messages";
import type { MessageKey } from "./i18n";

const filled = { email: "siti@example.com", name: "Siti", password: "password-1" };

describe("authDocumentTitle", () => {
	it("follows the page language", () => {
		expect(authDocumentTitle("id", "signUp")).toBe("Buat akun · RevKlik");
		expect(authDocumentTitle("en", "signUp")).toBe("Create account · RevKlik");
		expect(authDocumentTitle("id", "signIn")).toBe("Masuk · RevKlik");
		expect(authDocumentTitle("id", "verify")).toBe("Verifikasi email · RevKlik");
	});
});

describe("marketingUrl and docsUrl", () => {
	it("uses the root for Indonesian and /en for English, extensionless", () => {
		expect(marketingUrl("id", "terms")).toBe("https://revklik.com/terms");
		expect(marketingUrl("en", "terms")).toBe("https://revklik.com/en/terms");
		expect(marketingUrl("id", "privacy")).toBe("https://revklik.com/privacy");
		expect(marketingUrl("en", "privacy")).toBe("https://revklik.com/en/privacy");
	});

	it("keeps the trailing slash on the home pages only", () => {
		expect(marketingUrl("id", "")).toBe("https://revklik.com/");
		expect(marketingUrl("en", "")).toBe("https://revklik.com/en/");
		expect(docsUrl("id")).toBe("https://docs.revklik.com/id/");
		expect(docsUrl("en")).toBe("https://docs.revklik.com/");
	});
});

describe("validateAuthFields", () => {
	it("passes a filled sign-up form", () => {
		expect(validateAuthFields(filled, true)).toEqual({});
	});

	it("asks for each missing sign-up field", () => {
		expect(validateAuthFields({ email: " ", name: "  ", password: "" }, true)).toEqual({
			email: "auth.err.emailRequired",
			name: "auth.err.nameRequired",
			password: "auth.err.passwordRequired",
		});
	});

	it("tells a malformed email from a missing one", () => {
		expect(validateAuthFields({ ...filled, email: "siti@" }, true).email).toBe(
			"auth.err.emailInvalid",
		);
		expect(validateAuthFields({ ...filled, email: "siti@example" }, true).email).toBe(
			"auth.err.emailInvalid",
		);
	});

	it("enforces the 8 character password on sign-up only", () => {
		expect(validateAuthFields({ ...filled, password: "1234567" }, true).password).toBe(
			"auth.err.passwordShort",
		);
		expect(validateAuthFields({ ...filled, name: "", password: "1234567" }, false)).toEqual({});
	});
});

describe("firstInvalidField", () => {
	it("follows the visual order of the form", () => {
		expect(
			firstInvalidField({ email: "auth.err.emailRequired", password: "auth.err.passwordShort" }),
		).toBe("email");
		expect(
			firstInvalidField({ name: "auth.err.nameRequired", password: "auth.err.passwordShort" }),
		).toBe("name");
		expect(firstInvalidField({})).toBeUndefined();
	});
});

describe("auth copy", () => {
	const AUTH_KEY = /^(auth|verify|forgot|reset)\./u;
	const informalYou = /\bkamu\b|\w+mu\b/iu;

	it("addresses the reader as Anda in Indonesian on every auth page string", () => {
		for (const [key, text] of Object.entries(MESSAGES.id)) {
			if (AUTH_KEY.test(key)) {
				expect(informalYou.test(text), `${key}: ${text}`).toBe(false);
			}
		}
	});

	it("has an Indonesian validation message for every error key", () => {
		const errorKeys = Object.keys(MESSAGES.en).filter((key) => key.startsWith("auth.err."));
		for (const key of errorKeys) {
			expect(translate("id", key as MessageKey)).not.toBe(translate("en", key as MessageKey));
		}
	});
});

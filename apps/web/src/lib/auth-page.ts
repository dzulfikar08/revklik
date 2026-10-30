/**
 * Pure helpers for the signed-out pages (sign-up, sign-in, reset, verify):
 * localized document titles, links to the marketing site and docs, and the
 * form validation that replaces the browser's native, English-only bubbles.
 */
import { useEffect } from "react";

import { translate, useLocale } from "./i18n";
import type { Locale, MessageKey } from "./i18n";

const MARKETING_ORIGIN = "https://revklik.com";
const DOCS_ORIGIN = "https://docs.revklik.com";

export const MIN_PASSWORD_LENGTH = 8;

export type AuthPage = "signUp" | "signIn" | "verify" | "reset";

const PAGE_TITLE_KEY: Record<AuthPage, MessageKey> = {
	reset: "auth.pageTitle.reset",
	signIn: "auth.pageTitle.signIn",
	signUp: "auth.pageTitle.signUp",
	verify: "auth.pageTitle.verify",
};

/** "Buat akun · RevKlik": the tab title in the visitor's language. */
export const authDocumentTitle = (locale: Locale, page: AuthPage): string =>
	`${translate(locale, PAGE_TITLE_KEY[page])} · RevKlik`;

/** Keeps the tab title in step with the ID/EN toggle after first render. */
export const useAuthDocumentTitle = (page: AuthPage | undefined): void => {
	const locale = useLocale();
	useEffect(() => {
		if (page) {
			document.title = authDocumentTitle(locale, page);
		}
	}, [locale, page]);
};

/**
 * Marketing-site URL for the language: Indonesian lives at the root, English
 * under /en. Pages are extensionless; only the home page has a trailing slash.
 */
export const marketingUrl = (
	locale: Locale,
	path: "" | "privacy" | "terms" | "support",
): string => {
	const prefix = locale === "en" ? "/en" : "";
	if (path === "") {
		return `${MARKETING_ORIGIN}${prefix}/`;
	}
	return `${MARKETING_ORIGIN}${prefix}/${path}`;
};

/** Docs home: English at the root, Bahasa Indonesia under /id. */
export const docsUrl = (locale: Locale): string =>
	locale === "id" ? `${DOCS_ORIGIN}/id/` : `${DOCS_ORIGIN}/`;

export type AuthField = "name" | "email" | "password";
export type AuthFieldErrors = Partial<Record<AuthField, MessageKey>>;

const FIELD_ORDER: readonly AuthField[] = ["name", "email", "password"];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * What is wrong with the form, as message keys. Sign-up also needs a name and
 * a password of at least eight characters; sign-in only needs both filled in,
 * since the server decides whether the credentials are right.
 */
export const validateAuthFields = (
	values: { name: string; email: string; password: string },
	signUp: boolean,
): AuthFieldErrors => {
	const errors: AuthFieldErrors = {};
	if (signUp && !values.name.trim()) {
		errors.name = "auth.err.nameRequired";
	}
	const email = values.email.trim();
	if (!email) {
		errors.email = "auth.err.emailRequired";
	} else if (!EMAIL_SHAPE.test(email)) {
		errors.email = "auth.err.emailInvalid";
	}
	if (!values.password) {
		errors.password = "auth.err.passwordRequired";
	} else if (signUp && values.password.length < MIN_PASSWORD_LENGTH) {
		errors.password = "auth.err.passwordShort";
	}
	return errors;
};

/** The first field with an error, in visual order, so focus can jump to it. */
export const firstInvalidField = (errors: AuthFieldErrors): AuthField | undefined =>
	FIELD_ORDER.find((field) => errors[field] !== undefined);

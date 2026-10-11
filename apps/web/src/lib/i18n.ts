/**
 * Minimal i18n: two locales, one flat dictionary, a hook. The locale comes
 * from localStorage (the ID/EN toggle), else from navigator.language.
 * Strings live in ./i18n-messages; English is the fallback for any gap.
 */
import { useCallback, useSyncExternalStore } from "react";

import { MESSAGES } from "./i18n-messages";
import type { MessageKey } from "./i18n-messages";

export type Locale = "en" | "id";
export type { MessageKey };

const STORAGE_KEY = "kp_locale";

export const detectLocale = (): Locale => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === "en" || stored === "id") {
			return stored;
		}
	} catch {
		// Storage blocked (private mode); fall through to the browser language.
	}
	if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("id")) {
		return "id";
	}
	return "en";
};

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

const syncDocumentLang = (locale: Locale): void => {
	if (typeof document !== "undefined") {
		document.documentElement.lang = locale;
	}
};
syncDocumentLang(current);

export const getLocale = (): Locale => current;

export const setLocale = (locale: Locale): void => {
	current = locale;
	try {
		localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		// Not persisted; still switches for this page view.
	}
	syncDocumentLang(locale);
	for (const listener of listeners) {
		listener();
	}
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const useLocale = (): Locale => useSyncExternalStore(subscribe, getLocale, getLocale);

type Vars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/gu;

/**
 * Look up `key` for `locale` and fill `{name}` placeholders. When `vars.n`
 * is 1 and a `<key>_one` entry exists, that singular form wins.
 */
export const translate = (locale: Locale, key: MessageKey, vars?: Vars): string => {
	const dict: Partial<Record<MessageKey, string>> = MESSAGES[locale];
	const singular = vars?.n === 1 ? dict[`${key}_one` as MessageKey] : undefined;
	const template = singular ?? dict[key] ?? MESSAGES.en[key];
	if (!vars) {
		return template;
	}
	return template.replace(PLACEHOLDER, (match, name: string) =>
		name in vars ? String(vars[name]) : match,
	);
};

/** Translate outside React (toasts fired from the query cache, etc.). */
export const t = (key: MessageKey, vars?: Vars): string => translate(current, key, vars);

export const useT = (): ((key: MessageKey, vars?: Vars) => string) => {
	const locale = useLocale();
	return useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
};

/** id-ID dates read "12 Okt 2026"; en-GB keeps day-month order too. */
export const formatDate = (iso: string, locale: Locale): string =>
	new Date(iso).toLocaleDateString(locale === "id" ? "id-ID" : "en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});

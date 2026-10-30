/**
 * Shared UI models + formatting helpers for the analytics page.
 * All data comes from the production API (see lib/legacy/api.ts).
 */
import { getLocale, t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

import { avatarUrl, nameFromVisitorId } from "./identity";

/* --------------------------------- types ----------------------------------- */

export type RangeKey = "24h" | "7d" | "30d" | "90d";

export interface Point {
	label: string;
	full: string;
	current: number;
	/** Raw ISO timestamp from the timeseries; used to place annotations. */
	date?: string;
	/** Visitors in the equivalent previous window; omit when unavailable. */
	previous?: number;
}

export interface CountRow {
	label: string;
	value: number;
	flag?: string;
}

export interface FunnelStep {
	section: string;
	visitors: number;
	percentage: number;
	dropoff: number;
}

export interface PageFunnel {
	path: string;
	steps: FunnelStep[];
	totalVisitors: number;
	conversionRate: number;
}

export type VisitorEventKind = "view" | "scroll" | "section" | "click" | "conversion" | "event";

export interface VisitorEvent {
	time: string;
	kind: VisitorEventKind;
	page?: string;
	milestone?: number | null;
	section?: string;
	click?: string;
	event?: string;
	revenue?: string;
	props?: [string, string][];
}

export interface Visitor {
	id: string;
	visitorId: string;
	name: string | null;
	email: string | null;
	flag: string;
	country: string | null;
	city: string | null;
	device: string | null;
	os: string | null;
	browser: string | null;
	source: string;
	spent: string | null;
	lastSeen: string;
	activity: readonly number[];
	customer: boolean;
	params: readonly string[];
	tags: readonly string[];
	note: string;
	events: readonly VisitorEvent[];
}

export interface ActiveFilter {
	dimension: string;
	operator: string;
	value: string;
}

/* -------------------------------- formats ---------------------------------- */

/**
 * Number, money and date helpers follow the active UI language (id-ID groups
 * with dots, "Rp 232.000", "23 Okt"). They read the locale at call time;
 * the dashboard remounts its content on a language switch so cached values
 * never go stale.
 */
const intlTag = (): string => (getLocale() === "id" ? "id-ID" : "en-US");

const numberFormats = new Map<string, Intl.NumberFormat>();

const numberFormat = (key: string, make: (tag: string) => Intl.NumberFormat): Intl.NumberFormat => {
	const tag = intlTag();
	const cacheKey = `${tag}|${key}`;
	const cached = numberFormats.get(cacheKey);
	if (cached) {
		return cached;
	}
	const created = make(tag);
	numberFormats.set(cacheKey, created);
	return created;
};

export const fmt = (v: number): string =>
	numberFormat("int", (tag) => new Intl.NumberFormat(tag)).format(Math.round(v));
export const fmtC = (v: number): string =>
	numberFormat(
		"compact",
		(tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 1, notation: "compact" }),
	).format(Math.round(v));

/** Fractional number with `digits` decimals in the active language ("1,4" / "1.4"). */
export const fmtDecimal = (v: number, digits = 1): string =>
	numberFormat(
		`dec${digits}`,
		(tag) =>
			new Intl.NumberFormat(tag, { maximumFractionDigits: digits, minimumFractionDigits: digits }),
	).format(v);

/** Whole-unit currency formatter; IDR always uses id-ID grouping ("Rp 64.000"). */
const moneyFormat = (currency: string): Intl.NumberFormat | null => {
	try {
		return numberFormat(
			`money:${currency}`,
			(tag) =>
				new Intl.NumberFormat(currency === "IDR" ? "id-ID" : tag, {
					currency,
					maximumFractionDigits: 0,
					minimumFractionDigits: 0,
					style: "currency",
				}),
		);
	} catch {
		// Unknown ISO code from the API: callers fall back to USD formatting.
		return null;
	}
};

/** Revenue amount in `currency` (ISO 4217, default USD), rounded to whole units. */
export const money = (v: number, currency?: string | null): string => {
	const code = currency?.toUpperCase() || "USD";
	const formatted = moneyFormat(code) ?? moneyFormat("USD");
	return formatted ? formatted.format(Math.round(v)) : `$${Math.round(v)}`;
};
export const pctDelta = (now: number, before: number): number =>
	before === 0 ? 0 : ((now - before) / before) * 100;
export const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${fmtDecimal(v, 1)}%`;

/**
 * KPI delta badge, or null when there is nothing honest to compare against:
 * no compare block, a null changePct, or a previous value of 0 (the API then
 * sends changePct 0, which would read as a flat "+0.0%").
 */
export const deltaBadge = (
	change: { previous: number; changePct: number | null } | undefined,
	lowerIsBetter = false,
): { label: string; tone: "good" | "bad" } | null => {
	if (!change?.previous || change.changePct === null || !Number.isFinite(change.changePct)) {
		return null;
	}
	const pct = change.changePct;
	const better = lowerIsBetter ? pct <= 0 : pct >= 0;
	return { label: fmtPct(pct), tone: better ? "good" : "bad" };
};
export const duration = (s: number): string =>
	t("time.duration", { m: Math.floor(s / 60), s: String(Math.round(s % 60)).padStart(2, "0") });

export const niceMax = (v: number): number => {
	const base = 10 ** Math.floor(Math.log10(v));
	for (const m of [1, 2, 2.5, 5, 10]) {
		if (m * base >= v) {
			return m * base;
		}
	}
	return 10 * base;
};

/* ------------------------------- date labels -------------------------------- */

export const RANGES: readonly { key: RangeKey; label: string }[] = [
	{ key: "24h", label: "24h" },
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
];

const dateFormats = new Map<string, Intl.DateTimeFormat>();

const dateFormat = (key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
	const tag = intlTag();
	const cacheKey = `${tag}|${key}`;
	const cached = dateFormats.get(cacheKey);
	if (cached) {
		return cached;
	}
	const created = new Intl.DateTimeFormat(tag, options);
	dateFormats.set(cacheKey, created);
	return created;
};

const SHORT_DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** "23 Okt" / "Oct 23". */
export const shortDate = (d: Date): string => dateFormat("short", SHORT_DAY).format(d);

/** Chart tick + full labels for a timeseries point. */
export const pointLabel = (iso: string, hourly: boolean): { label: string; full: string } => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return { full: iso, label: iso };
	}
	if (hourly) {
		const hh = String(d.getHours()).padStart(2, "0");
		return { full: `${shortDate(d)}, ${hh}:00`, label: `${hh}:00` };
	}
	return {
		full: dateFormat("full", { ...SHORT_DAY, year: "numeric" }).format(d),
		label: shortDate(d),
	};
};

/** "2:13 AM" / "14.13" time-of-day for journey steps. */
export const timeLabel = (iso: string): string => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return "";
	}
	return dateFormat("time", { hour: "numeric", minute: "2-digit" }).format(d);
};

/** Relative "last seen" label: minutes/hours ago, then a date. */
export const agoLabel = (iso: string): string => {
	const ms = new Date(iso).getTime();
	if (Number.isNaN(ms)) {
		return "";
	}
	const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
	if (mins < 1) {
		return t("time.justNow");
	}
	if (mins < 60) {
		return t("time.minsAgo", { n: mins });
	}
	const hours = Math.round(mins / 60);
	if (hours < 24) {
		return t("time.hoursAgo", { n: hours });
	}
	return shortDate(new Date(iso));
};

/** Weekday date header for the journey timeline. */
export const dayLabel = (iso: string): string =>
	dateFormat("day", {
		day: "numeric",
		month: "short",
		weekday: "long",
		year: "numeric",
	}).format(new Date(iso));

/* --------------------------------- filters --------------------------------- */

/** Dimensions accepted by the /analytics/* filters param. */
export const FILTER_DIMS: readonly { value: string; label: MessageKey }[] = [
	{ label: "fdim.source", value: "source" },
	{ label: "fdim.path", value: "path" },
	{ label: "fdim.entry_path", value: "entry_path" },
	{ label: "fdim.country", value: "country" },
	{ label: "fdim.region", value: "region" },
	{ label: "fdim.city", value: "city" },
	{ label: "fdim.device_type", value: "device_type" },
	{ label: "fdim.browser", value: "browser" },
	{ label: "fdim.os", value: "os" },
	{ label: "fdim.referrer", value: "referrer" },
	{ label: "fdim.utm_source", value: "utm_source" },
	{ label: "fdim.utm_medium", value: "utm_medium" },
	{ label: "fdim.utm_campaign", value: "utm_campaign" },
	{ label: "fdim.payment_method", value: "payment_method" },
	{ label: "fdim.payment_provider", value: "payment_provider" },
];

export const FILTER_OPS: readonly { value: string; label: MessageKey }[] = [
	{ label: "fop.is", value: "is" },
	{ label: "fop.is_not", value: "is_not" },
	{ label: "fop.contains", value: "contains" },
	{ label: "fop.not_contains", value: "not_contains" },
	{ label: "fop.starts_with", value: "starts_with" },
	{ label: "fop.exists", value: "exists" },
	{ label: "fop.not_exists", value: "not_exists" },
];

/* -------------------------------- visitors --------------------------------- */

export const visitorName = (v: Pick<Visitor, "name" | "visitorId">): string =>
	v.name ?? nameFromVisitorId(v.visitorId);

export const visitorAvatar = (v: Pick<Visitor, "name" | "visitorId">): string =>
	avatarUrl(visitorName(v));

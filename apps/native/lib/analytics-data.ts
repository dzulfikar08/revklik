/**
 * Shared UI models + formatting helpers for the analytics screens.
 * Port of apps/web/src/components/analytics/data.ts. All data comes from
 * the production API (see lib/klikapa/api.ts).
 */
import { nameFromVisitorId } from "./identity";
import { numberLocale } from "./i18n";

/* --------------------------------- types ----------------------------------- */

export type RangeKey = "24h" | "7d" | "30d" | "90d";

export interface Point {
	label: string;
	full: string;
	current: number;
	/** Raw ISO timestamp from the timeseries. */
	date?: string;
	/** Visitors in the equivalent previous window; omit when unavailable. */
	previous?: number;
}

export interface CountRow {
	label: string;
	value: number;
	flag?: string;
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

/* -------------------------------- formats ---------------------------------- */

export const nf = new Intl.NumberFormat(numberLocale);
export const fmt = (v: number): string => nf.format(Math.round(v));
const nfc = new Intl.NumberFormat(numberLocale, {
	maximumFractionDigits: 1,
	notation: "compact",
});
export const fmtC = (v: number): string => nfc.format(Math.round(v));

const moneyFormats = new Map<string, Intl.NumberFormat | null>();
const moneyFormat = (code: string): Intl.NumberFormat | null => {
	if (!moneyFormats.has(code)) {
		try {
			moneyFormats.set(
				code,
				new Intl.NumberFormat(code === "IDR" ? "id-ID" : numberLocale, {
					currency: code,
					maximumFractionDigits: 0,
					minimumFractionDigits: 0,
					style: "currency",
				}),
			);
		} catch {
			moneyFormats.set(code, null);
		}
	}
	return moneyFormats.get(code) ?? null;
};

/** Revenue in `currency` (ISO 4217, USD when absent), whole units, like the web dashboard. */
export const money = (v: number, currency?: string | null): string => {
	const code = currency?.toUpperCase() || "USD";
	const formatter = moneyFormat(code) ?? moneyFormat("USD");
	return formatter ? formatter.format(Math.round(v)) : `$${Math.round(v)}`;
};
export const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
export const duration = (s: number): string =>
	`${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

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

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

export const RANGES: readonly { key: RangeKey; label: string }[] = [
	{ key: "24h", label: "24h" },
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
];

/** Chart tick + full labels for a timeseries point. */
export const pointLabel = (iso: string, hourly: boolean): { label: string; full: string } => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return { full: iso, label: iso };
	}
	if (hourly) {
		const hh = String(d.getHours()).padStart(2, "0");
		return {
			full: `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:00`,
			label: `${hh}:00`,
		};
	}
	const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
	return { full: `${md}, ${d.getFullYear()}`, label: md };
};

/** "2:13 AM" style time-of-day for journey steps. */
export const timeLabel = (iso: string): string => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return "";
	}
	return d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
};

/** Relative "last seen" label: minutes/hours ago, then a date. */
export const agoLabel = (iso: string): string => {
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) {
		return "";
	}
	const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
	if (mins < 1) {
		return "just now";
	}
	if (mins < 60) {
		return `${mins}m ago`;
	}
	const hours = Math.round(mins / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const d = new Date(iso);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/** Weekday date header for the journey timeline. */
export const dayLabel = (iso: string): string =>
	new Date(iso).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		weekday: "long",
		year: "numeric",
	});

/* --------------------------------- filters --------------------------------- */

/** Dimensions accepted by the /analytics/* filters param. */
export const FILTER_DIMS: readonly { value: string; label: string }[] = [
	{ label: "Page", value: "path" },
	{ label: "Country", value: "country" },
	{ label: "Region", value: "region" },
	{ label: "City", value: "city" },
	{ label: "Device", value: "device_type" },
	{ label: "Browser", value: "browser" },
	{ label: "OS", value: "os" },
	{ label: "Referrer", value: "referrer" },
	{ label: "UTM Source", value: "utm_source" },
	{ label: "UTM Medium", value: "utm_medium" },
	{ label: "UTM Campaign", value: "utm_campaign" },
];

export const FILTER_OPS: readonly { value: string; label: string }[] = [
	{ label: "is", value: "is" },
	{ label: "is not", value: "is_not" },
	{ label: "contains", value: "contains" },
	{ label: "excludes", value: "not_contains" },
	{ label: "starts with", value: "starts_with" },
	{ label: "exists", value: "exists" },
	{ label: "missing", value: "not_exists" },
];

/* -------------------------------- visitors --------------------------------- */

export const visitorName = (v: Pick<Visitor, "name" | "visitorId">): string =>
	v.name ?? nameFromVisitorId(v.visitorId);

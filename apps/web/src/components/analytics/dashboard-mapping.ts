/**
 * Pure mapping from API payloads to the dashboard's view models: journey steps
 * to visitor events, profiles to visitors, geo rows to ranked counts.
 */
import { countryFlag } from "@/lib/legacy/api";
import type { GeoRow, JourneyStep, VisitorJourney, VisitorProfile } from "@/lib/legacy/api";

import { agoLabel, money } from "./data";
import type { CountRow, Visitor, VisitorEvent } from "./data";

/* -------------------------------- mapping ---------------------------------- */

export const hostOf = (referrer: string | null | undefined): string | null => {
	if (!referrer) {
		return null;
	}
	try {
		return new URL(referrer).host.replace(/^www\./u, "");
	} catch {
		return referrer;
	}
};

const parseTags = (raw: string | null): string[] => {
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.map((t) => `${t}`);
		}
	} catch {
		/* plain string */
	}
	return raw
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
};

const parseProps = (raw: string | null): [string, string][] => {
	if (!raw) {
		return [];
	}
	try {
		const obj = JSON.parse(raw) as Record<string, unknown>;
		return Object.entries(obj).map(([k, v]) => [k, `${v}`]);
	} catch {
		return [];
	}
};

/** `currency` is the dashboard response's ISO code; USD when absent. */
export const stepToEvent = (s: JourneyStep, currency?: string): VisitorEvent | null => {
	if (s.event_type === "pageview") {
		return { kind: "view", page: s.path, time: s.timestamp };
	}
	if (s.event_type === "conversion") {
		const p = parseProps(s.props);
		return {
			event: s.name ?? "conversion",
			kind: "conversion",
			props: p.length ? p : undefined,
			revenue: s.revenue ? money(s.revenue, currency) : undefined,
			time: s.timestamp,
		};
	}
	if (s.event_type !== "custom") {
		return { event: s.name ?? s.event_type, kind: "event", time: s.timestamp };
	}
	const p = parseProps(s.props);
	const kv = Object.fromEntries(p);
	const withProps = p.length ? p : undefined;
	if (s.name === "heartbeat") {
		return null;
	}
	if (s.name === "scroll") {
		return {
			kind: "scroll",
			milestone: Number(kv["depth"] ?? 0) || null,
			props: withProps,
			time: s.timestamp,
		};
	}
	if (s.name === "scroll_section") {
		return {
			kind: "section",
			props: withProps,
			section: kv["section_id"] ?? kv["section"] ?? s.path,
			time: s.timestamp,
		};
	}
	if (s.name === "click") {
		return {
			click: kv["text"] ?? kv["target"] ?? s.path,
			kind: "click",
			props: withProps,
			time: s.timestamp,
		};
	}
	return {
		event: s.name ?? "custom",
		kind: "event",
		props: withProps,
		time: s.timestamp,
	};
};

export const profileToVisitor = (
	p: VisitorProfile,
	journeys: VisitorJourney[],
	currency?: string,
): Visitor => {
	const mine = journeys
		.filter((j) => j.visitor_id === p.visitor_id)
		.toSorted((a, b) => a.started_at.localeCompare(b.started_at));
	const events = mine
		.flatMap((j) => j.steps.map((s) => stepToEvent(s, currency)))
		.filter((e): e is VisitorEvent => e !== null)
		.toSorted((a, b) => a.time.localeCompare(b.time));
	const source = mine[0]?.utm_source ?? hostOf(mine[0]?.referrer) ?? "direct";
	const now = Date.now();
	const activity = Array.from({ length: 7 }, (_, i) => {
		const dayStart = new Date(now - (6 - i) * 86_400_000);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = dayStart.getTime() + 86_400_000;
		return mine.some((j) => {
			const t = new Date(j.started_at).getTime();
			return t >= dayStart.getTime() && t < dayEnd;
		})
			? 1
			: 0;
	});
	return {
		activity,
		browser: p.browser,
		city: p.city,
		country: p.country,
		customer: p.total_revenue > 0,
		device: p.device_type,
		email: p.email,
		events,
		flag: countryFlag(p.country),
		id: p.id,
		lastSeen: agoLabel(p.last_seen),
		name: p.name,
		note: p.notes ?? "",
		os: p.os,
		params: [],
		source,
		spent: p.total_revenue > 0 ? money(p.total_revenue, currency) : null,
		tags: parseTags(p.tags),
		visitorId: p.visitor_id,
	};
};

export const aggregateGeo = (rows: GeoRow[], keyOf: (r: GeoRow) => string | null): CountRow[] => {
	const map = new Map<string, number>();
	for (const r of rows) {
		const key = keyOf(r);
		if (!key) {
			continue;
		}
		map.set(key, (map.get(key) ?? 0) + r.visitors);
	}
	return [...map.entries()]
		.toSorted((a, b) => b[1] - a[1])
		.map(([label, value]) => ({
			flag: countryFlag(label) || undefined,
			label,
			value,
		}));
};

export const deviceGlyph = (device: string) => {
	const d = device.toLowerCase();
	if (d.includes("mobile") || d.includes("phone")) {
		return { device: "mobile" as const };
	}
	if (d.includes("tablet")) {
		return { device: "tablet" as const };
	}
	return { device: "desktop" as const };
};

export const NEUTRAL_GLYPH = {
	bg: "color-mix(in oklab, var(--muted-foreground) 40%, transparent)",
	shape: "square" as const,
};

export const journeyChip = (s: JourneyStep, currency?: string): string => {
	if (s.event_type === "pageview") {
		return s.path || "/";
	}
	if (s.event_type === "conversion") {
		return `${s.name ?? "purchase"} ${money(s.revenue ?? 0, currency)}`;
	}
	return s.name ?? s.event_type;
};

const regionNames = new Map<string, Intl.DisplayNames>();

/** "ID" reads "Indonesia"; anything Intl cannot name stays as the raw code. */
export const countryName = (code: string, locale: string): string => {
	try {
		let names = regionNames.get(locale);
		if (!names) {
			names = new Intl.DisplayNames([locale], { type: "region" });
			regionNames.set(locale, names);
		}
		return names.of(code.toUpperCase()) ?? code;
	} catch {
		return code;
	}
};

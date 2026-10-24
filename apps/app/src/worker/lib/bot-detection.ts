import { classifyDatacenterVisitor } from "../utils";

/**
 * Non-human traffic rules. Two stages share one vocabulary of reason codes:
 *   - ingest (`classifyIngestSignals`): what a single request proves on its own;
 *   - reclassification (`classifySession`): what a whole session proves, so old
 *     rows can be re-judged whenever a rule changes (lib/bot-reclassify.ts).
 * Flagged rows stay in the database with `is_bot = 1`; every analytics read
 * excludes them (lib/bot-filter-plugin.ts).
 */

export type BotReason =
	| "webdriver"
	| "bot_score"
	| "datacenter_city"
	| "datacenter_org"
	| "scroll_burst"
	| "pageview_burst"
	| "click_flood"
	| "passive_linux_hit";

/** Reasons decided from request data that a session replay cannot reproduce. */
const INGEST_ONLY_REASONS: Record<string, true> = { webdriver: true, bot_score: true };

/**
 * Cities that exist in visitor data almost only because a cloud region sits
 * there (lowercase). Real people in these towns are rare enough that counting
 * them as visitors costs less than the scanner traffic they replace. Add a city
 * only after seeing it carry traffic that never scrolls, clicks or stays.
 */
export const DATACENTER_CITIES: readonly string[] = [
	"ashburn",
	"leesburg",
	"centreville",
	"sterling",
	"herndon",
	"boardman",
	"the dalles",
	"council bluffs",
	"moses lake",
	"quincy",
];

/** Cloudflare Bot Management score below this is automated (1 = certainly a bot). */
export const BOT_SCORE_THRESHOLD = 30;

/** Scroll milestones sharing one millisecond: the tracker emits at most one per scroll. */
export const SCROLL_BURST_MIN_EVENTS = 3;
/**
 * A session that jumps to the bottom of the page inside this window, without a
 * single click, was not read by a person (observed scanners: 1 to 2.5 s).
 */
export const SCROLL_BURST_MAX_SPAN_SECONDS = 3;
/** Consecutive pageviews closer than this are one script, not navigation. */
export const PAGEVIEW_BURST_GAP_SECONDS = 0.2;
export const PAGEVIEW_BURST_MIN_GAPS = 2;
/** Sustained clicking beyond human speed (1284 clicks in 3.4 minutes was observed). */
export const CLICK_FLOOD_MIN_CLICKS = 100;

export interface IngestSignals {
	city?: string | null;
	asOrganization?: string | null;
	/** `request.cf.botManagement.score`; only present on Cloudflare Bot Management plans. */
	botScore?: number | null;
	/** Tracker-reported `navigator.webdriver` (set by Selenium, Playwright, Puppeteer). */
	webdriver?: boolean;
}

export function isDatacenterCity(city: string | null | undefined): boolean {
	return !!city && DATACENTER_CITIES.includes(city.trim().toLowerCase());
}

/** The strongest single-request bot signal, or null when the request looks human. */
export function classifyIngestSignals(signals: IngestSignals): BotReason | null {
	if (signals.webdriver) return "webdriver";
	if (typeof signals.botScore === "number" && signals.botScore < BOT_SCORE_THRESHOLD) {
		return "bot_score";
	}
	if (classifyDatacenterVisitor(signals.asOrganization)) return "datacenter_org";
	if (isDatacenterCity(signals.city)) return "datacenter_city";
	return null;
}

/** Everything a session's events and row say about who produced it. */
export interface SessionFeatures {
	city: string | null;
	os: string | null;
	deviceType: string | null;
	asOrg: string | null;
	events: number;
	pageviews: number;
	clicks: number;
	/** Seconds between the first and last event. */
	spanSeconds: number;
	/** Most `scroll` events that share one timestamp. */
	maxScrollSameMs: number;
	/** Pageview-to-pageview gaps shorter than PAGEVIEW_BURST_GAP_SECONDS. */
	quickPageviewGaps: number;
	/** Reason recorded when the session was ingested, if any. */
	existingReason: string | null;
}

/**
 * Judge a whole session. Order is the reporting priority: the first rule that
 * fires names the session. A reason decided from request data at ingest
 * (webdriver, bot score) is kept, since it cannot be recomputed from rows.
 */
export function classifySession(f: SessionFeatures): BotReason | null {
	if (f.existingReason && INGEST_ONLY_REASONS[f.existingReason]) {
		return f.existingReason as BotReason;
	}
	if (classifyDatacenterVisitor(f.asOrg)) return "datacenter_org";
	if (isDatacenterCity(f.city)) return "datacenter_city";
	if (
		f.maxScrollSameMs >= SCROLL_BURST_MIN_EVENTS &&
		f.spanSeconds <= SCROLL_BURST_MAX_SPAN_SECONDS &&
		f.clicks === 0
	) {
		return "scroll_burst";
	}
	if (f.quickPageviewGaps >= PAGEVIEW_BURST_MIN_GAPS) return "pageview_burst";
	if (f.clicks >= CLICK_FLOOD_MIN_CLICKS) return "click_flood";
	// One pageview and nothing else from a Linux/unknown desktop: a fetch by a
	// headless browser. A person who bounces inside the first seconds looks the
	// same, which is the accepted cost; a person who scrolls, clicks or reads
	// produces a second event and is never matched.
	const os = f.os?.toLowerCase() ?? "";
	if (
		f.events === 1 &&
		f.pageviews === 1 &&
		(os === "linux" || os === "other") &&
		(f.deviceType ?? "desktop") === "desktop"
	) {
		return "passive_linux_hit";
	}
	return null;
}

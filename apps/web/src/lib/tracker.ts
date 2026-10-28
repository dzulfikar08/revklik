/**
 * RevKlik tracks its own sign-up funnel: the tracker runs on /login and
 * /register (and the Google OAuth return) under the revklik.com site, so those
 * pageviews carry host app.revklik.com and the visit that began on the
 * marketing site continues into them. It is never loaded for the dashboard.
 */
import { isSelfHosted } from "./instance-config";
import { parseTrackerId } from "./signup-intent";

/** The revklik.com site; self-hosted installs track nothing here. */
export const SELF_SITE_ID = "d9701d64-9e78-4b73-9726-e4f41593b843";

// The tracker's own storage keys (see apps/app/public/klikapa.js).
const VISITOR_STORAGE_KEY = "_kp_vid";
const SESSION_STORAGE_KEY = "_kp_sid";

export interface JourneyIds {
	/** `rk_vid` from the marketing site's link. */
	visitorId?: unknown;
	/** `rk_sid` from the marketing site's link. */
	sessionId?: unknown;
}

/**
 * The tracker reads its ids from storage when it starts, so the marketing
 * site's visitor (and session) are written there first: this origin's pageviews
 * then join the visit instead of opening a new visitor.
 */
const adoptJourney = ({ visitorId, sessionId }: JourneyIds): void => {
	const vid = parseTrackerId(visitorId);
	const sid = parseTrackerId(sessionId);
	try {
		if (vid) localStorage.setItem(VISITOR_STORAGE_KEY, vid);
		if (sid) sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
	} catch {
		// Storage blocked: the tracker falls back to its own ids.
	}
};

/** Start the tracker once per page load. No-op on self-hosted installs. */
export const loadAuthTracker = (journey: JourneyIds = {}): void => {
	const page = document.documentElement.dataset;
	if (page.rkTracker || isSelfHosted()) return;
	page.rkTracker = "1";
	adoptJourney(journey);
	const script = document.createElement("script");
	script.src = "/klikapa.js";
	script.defer = true;
	script.setAttribute("data-site-id", SELF_SITE_ID);
	document.head.append(script);
};

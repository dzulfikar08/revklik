/**
 * Visitor deep-linking endpoint from apps/web/src/lib/legacy/growth.ts.
 * The remaining Growth-tier routes (heatmap, recordings, AI insights,
 * predictions) have no native surface yet and are intentionally not ported.
 */
import type { VisitorJourney, VisitorProfile } from "./api";
import { legacyFetch } from "./api";

export interface VisitorProfileResult {
	profile: VisitorProfile;
	journeys: VisitorJourney[];
}

/**
 * GET /analytics/visitors/:visitorId — profile + recent journeys for one
 * visitor. Powers deep-links whose profile is outside the visitors list.
 * 404 when the visitor has no profile for the site.
 */
export const fetchVisitorProfile = (
	visitorId: string,
	siteId: string,
	range = "30d",
): Promise<VisitorProfileResult> =>
	legacyFetch(
		`/analytics/visitors/${encodeURIComponent(
			visitorId,
		)}?site_id=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
	);

/**
 * Client endpoints for the Growth-tier features (Wave 2):
 * heatmap, session recordings, AI insights, revenue predictions.
 *
 * All four routes are gated server-side: a non-Growth subscription receives
 * a 403 { error: "plan_required", required_plan }. Only that envelope is
 * surfaced here as a GrowthPlanLockedError; any other 403 stays a
 * LegacyApiError so it reaches the normal error path.
 */
import type { VisitorJourney, VisitorProfile } from "./api";
import { LegacyApiError, legacyFetch } from "./api";
import { parsePlan } from "./billing";

/* ---------------------------------- types ---------------------------------- */

export interface HeatmapScrollDepth {
	depth: number;
	visitors: number;
}

export interface HeatmapElement {
	selector: string;
	clicks: number;
	label: string;
}

export interface HeatmapData {
	clickGrid: number[][];
	scrollDepths: HeatmapScrollDepth[];
	totalSessions: number;
	totalClicks: number;
	topElements: HeatmapElement[];
}

export type RecordingEventType = "mutation" | "interaction" | "scroll" | "resize";

export interface RecordingEvent {
	t: number;
	type: RecordingEventType;
	d: unknown;
}

export interface RecordingSummary {
	id: string;
	session_id: string;
	path: string;
	duration: number;
	viewport_width: number | null;
	started_at: string;
	event_count: number;
	has_revenue: boolean;
}

export interface RecordingDetail extends RecordingSummary {
	events: RecordingEvent[];
	viewport_height: number | null;
}

export type InsightType =
	| "revenue_drivers"
	| "geo_opportunities"
	| "funnel_optimization"
	| "traffic_roi"
	| "revenue_prediction";

export interface AiInsight {
	id: string;
	type: InsightType;
	title: string;
	summary: string;
	detail: string;
	confidence: number;
	action: string | null;
}

export interface InsightsResponse {
	insights: AiInsight[];
	generated_at: string;
	data_summary: {
		total_events: number;
		total_revenue: number;
		date_range: string;
	};
}

export interface RevenuePrediction {
	visitor_id: string;
	conversion_probability: number;
	predicted_revenue: number;
	factors: string[];
}

export interface PredictionResponse {
	predictions: RevenuePrediction[];
	model_version: string;
	generated_at: string;
}

/* ---------------------------------- gate ----------------------------------- */

/** Thrown when a Growth-gated endpoint answers 403. */
export class GrowthPlanLockedError extends Error {
	requiredPlan: string;
	constructor(requiredPlan: string) {
		super(`This feature requires the ${requiredPlan} plan`);
		this.name = "GrowthPlanLockedError";
		this.requiredPlan = requiredPlan;
	}
}

const growthFetch = async <T>(path: string, opts?: RequestInit): Promise<T> => {
	try {
		return await legacyFetch<T>(path, opts);
	} catch (err) {
		// Only a plan gate becomes the lock. Other 403s (e.g. removed from a
		// team) must surface as real errors, since the lock is never toasted.
		if (err instanceof LegacyApiError && err.status === 403 && err.code === "plan_required") {
			throw new GrowthPlanLockedError(parsePlan(err.body?.required_plan) ?? "growth");
		}
		throw err;
	}
};

/* -------------------------------- endpoints -------------------------------- */

export const fetchHeatmap = (
	siteId: string,
	path: string,
	range: string,
	filters: string,
): Promise<HeatmapData> => {
	const p = new URLSearchParams({ site_id: siteId, path, range });
	if (filters) {
		p.set("filters", filters);
	}
	return growthFetch(`/analytics/heatmap?${p}`);
};

export const fetchRecordings = (
	siteId: string,
	range: string,
	filters: string,
): Promise<RecordingSummary[]> => {
	const p = new URLSearchParams({ site_id: siteId, range });
	if (filters) {
		p.set("filters", filters);
	}
	return growthFetch(`/analytics/recordings?${p}`);
};

export const fetchRecording = (id: string): Promise<RecordingDetail> =>
	growthFetch(`/analytics/recordings/${id}`);

export const fetchInsights = (siteId: string, range: string): Promise<InsightsResponse> =>
	growthFetch(`/ai-insights?${new URLSearchParams({ site_id: siteId, range })}`);

export const refreshInsights = (siteId: string, range: string): Promise<InsightsResponse> =>
	growthFetch("/ai-insights/refresh", {
		body: JSON.stringify({ site_id: siteId, range }),
		method: "POST",
	});

export const fetchPredictions = (siteId: string): Promise<PredictionResponse> =>
	growthFetch(`/predictions?site_id=${encodeURIComponent(siteId)}`);

export const refreshPredictions = (siteId: string): Promise<PredictionResponse> =>
	growthFetch(`/predictions/refresh?site_id=${encodeURIComponent(siteId)}`, {
		method: "POST",
	});

/* --------------------------- visitor deep-linking --------------------------- */

export interface VisitorProfileResult {
	profile: VisitorProfile;
	journeys: VisitorJourney[];
}

/**
 * GET /analytics/visitors/:visitorId — profile + recent journeys for one
 * visitor. Powers deep-links (e.g. prediction rows) whose profile is outside
 * the paginated visitors list. 404 when the visitor has no profile for the
 * site.
 */
export const fetchVisitorProfile = async (
	visitorId: string,
	siteId: string,
	range = "7d",
): Promise<VisitorProfileResult> =>
	legacyFetch(
		`/analytics/visitors/${encodeURIComponent(
			visitorId,
		)}?site_id=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
	);

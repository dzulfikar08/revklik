/**
 * Client functions for the share / live-widget / API-token endpoints of the
 * production klikapa Worker. Same `{ success, data, error }` envelope as
 * api.ts — reuse its internal `legacyFetch` helper.
 */

import { LEGACY_API_BASE, legacyFetch } from "./api";

/* --------------------------------- types ---------------------------------- */

export interface ShareStatus {
	public: boolean;
	share_token: string | null;
}

export interface WidgetStatus {
	enabled: boolean;
	widget_token: string | null;
	tz_offset: number;
}

export interface ApiTokenInfo {
	id: string;
	prefix: string;
	name: string;
	type: "account" | "site";
	scopes: string[];
	site_id: string | null;
	last_used_at: string | null;
	created_at: string;
}

/** Create response — `token` is the full secret, returned only once. */
export interface CreatedApiToken extends ApiTokenInfo {
	token: string;
}

export interface SubscriptionPlan {
	plan: string;
}

/* ------------------------------ public origins ---------------------------- */

/**
 * The klikapa Worker serves everything (API, /api/public/:token JSON,
 * klikapa-live.js) from one origin. Derive it from the configured API base so
 * the snippet/link point at the real backend even when this app runs elsewhere.
 */
export const API_ORIGIN = LEGACY_API_BASE.replace(/\/api\/?$/, "");

/** Read-only JSON feed behind a share token. */
export const shareUrl = (shareToken: string): string => `${LEGACY_API_BASE}/public/${shareToken}`;

/** Embeddable live-stats script served as a static asset at the origin root. */
export const widgetScriptUrl = `${API_ORIGIN}/klikapa-live.js`;

/** Token allowance per plan — mirrors the worker's PLAN_TOKEN_LIMITS. */
export const PLAN_TOKEN_LIMITS: Record<string, number> = {
	free: 2,
	micro: 2,
	starter: 5,
	growth: Number.POSITIVE_INFINITY,
};
export const tokenLimitForPlan = (plan: string | undefined): number => {
	if (plan && plan in PLAN_TOKEN_LIMITS) {
		return PLAN_TOKEN_LIMITS[plan];
	}
	return PLAN_TOKEN_LIMITS.free;
};

/* --------------------------------- share ---------------------------------- */

export const fetchShareStatus = (siteId: string): Promise<ShareStatus> =>
	legacyFetch(`/share/${siteId}/status`);

export const toggleShare = (siteId: string): Promise<ShareStatus> =>
	legacyFetch(`/share/${siteId}/toggle`, { method: "POST" });

/* --------------------------------- widget --------------------------------- */

export const fetchWidgetStatus = (siteId: string): Promise<WidgetStatus> =>
	legacyFetch(`/sites/${siteId}/widget/status`);

export const toggleWidget = (
	siteId: string,
): Promise<{ enabled: boolean; widget_token: string | null }> =>
	legacyFetch(`/sites/${siteId}/widget/toggle`, { method: "POST" });

export const regenerateWidgetToken = (siteId: string): Promise<{ widget_token: string }> =>
	legacyFetch(`/sites/${siteId}/widget/regenerate`, { method: "POST" });

export const updateWidgetConfig = (
	siteId: string,
	config: { tz_offset: number },
): Promise<{ tz_offset: number }> =>
	legacyFetch(`/sites/${siteId}/widget/config`, {
		method: "PATCH",
		body: JSON.stringify(config),
	});

/* --------------------------------- tokens --------------------------------- */

export const fetchApiTokens = (): Promise<ApiTokenInfo[]> => legacyFetch("/tokens");

export const createApiToken = (data: {
	name: string;
	type: "account" | "site";
	scopes?: string[];
	site_id?: string;
}): Promise<CreatedApiToken> =>
	legacyFetch("/tokens", { method: "POST", body: JSON.stringify(data) });

export const revokeApiToken = (id: string): Promise<void> =>
	legacyFetch(`/tokens/${id}`, { method: "DELETE" });

/* ----------------------------------- plan --------------------------------- */

export const fetchSubscriptionPlan = (): Promise<SubscriptionPlan> =>
	legacyFetch("/billing/subscription");

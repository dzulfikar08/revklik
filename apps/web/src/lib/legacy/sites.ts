/**
 * Site onboarding + management endpoints for the production klikapa Worker API.
 * Shapes mirror the old client (revklik apps/app/src/client/lib/api.ts).
 */
import {
	LEGACY_API_BASE,
	LegacyApiError,
	getToken,
	legacyFetch,
	legacyLogout,
	readableError,
} from "./api";
import type { LegacyErrorBody } from "./api";

export interface LegacySite {
	id: string;
	name: string;
	domain: string;
	created_at: string;
}

/* ---------------------------------- sites --------------------------------- */

/** POST /sites — worker requires both name and domain. */
export const createLegacySite = (name: string, domain: string): Promise<LegacySite> =>
	legacyFetch("/sites", {
		method: "POST",
		body: JSON.stringify({ name, domain }),
	});

/** Delay between DELETE retries while the worker is still purging tables. */
export const SITE_DELETE_DELAY_MS = 1000;
/** Give up after this many DELETE calls (about 30 s at the default delay). */
export const SITE_DELETE_MAX_ATTEMPTS = 30;

/** The worker was still purging when the retry cap was reached. */
export class SiteDeleteTimeoutError extends Error {
	constructor() {
		super("Site deletion is still running");
		this.name = "SiteDeleteTimeoutError";
	}
}

interface DeleteBody extends LegacyErrorBody {
	status?: string;
	remaining_tables?: unknown;
	data?: { status?: string; remaining_tables?: unknown };
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * DELETE /sites/:id purges a site table by table. While work remains the
 * worker answers 202 {status:"deleting", remaining_tables}; each repeat call
 * continues the purge. Resolves only on a final 200/204, so callers keep
 * the site in the UI until it is really gone.
 */
export const deleteLegacySite = async (
	id: string,
	{
		delayMs = SITE_DELETE_DELAY_MS,
		maxAttempts = SITE_DELETE_MAX_ATTEMPTS,
	}: { delayMs?: number; maxAttempts?: number } = {},
): Promise<void> => {
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const token = await getToken();
		// oxlint-disable-next-line no-await-in-loop -- each call continues the purge
		const res = await fetch(`${LEGACY_API_BASE}/sites/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});
		if (res.status === 200 || res.status === 204) {
			return;
		}
		if (res.status === 202) {
			if (attempt < maxAttempts) {
				// oxlint-disable-next-line no-await-in-loop -- deliberate backoff
				await sleep(delayMs);
			}
			continue;
		}
		if (res.status === 401) {
			legacyLogout();
			throw new LegacyApiError("Session expired. Sign in again", 401);
		}
		const body = (await res.json?.().catch(() => null)) as DeleteBody | null | undefined;
		throw new LegacyApiError(
			readableError(body?.error) ?? `Request failed (${res.status})`,
			res.status,
			body ?? undefined,
		);
	}
	throw new SiteDeleteTimeoutError();
};

export const fetchSiteSnippet = (id: string): Promise<{ siteId: string; snippet: string }> =>
	legacyFetch(`/sites/${id}/snippet`);

/* -------------------------- self-traffic exclusions ------------------------ */

export const fetchMyFingerprint = (siteId: string): Promise<{ fingerprint: string }> =>
	legacyFetch(`/sites/${siteId}/my-fingerprint`);

export const fetchExclusions = (siteId: string): Promise<string[]> =>
	legacyFetch(`/sites/${siteId}/exclusions`);

export const addExclusion = (siteId: string, fingerprint?: string): Promise<string[]> =>
	legacyFetch(`/sites/${siteId}/exclusions`, {
		method: "POST",
		body: JSON.stringify(fingerprint ? { fingerprint } : {}),
	});

export const removeExclusion = (siteId: string, fp: string): Promise<string[]> =>
	legacyFetch(`/sites/${siteId}/exclusions/${encodeURIComponent(fp)}`, {
		method: "DELETE",
	});

export const purgeMyVisits = (
	siteId: string,
	fingerprint?: string,
): Promise<{ events: number; sessions: number; profiles: number }> =>
	legacyFetch(`/sites/${siteId}/purge`, {
		method: "POST",
		body: JSON.stringify(fingerprint ? { fingerprint } : {}),
	});

/* ---------------------------------- export -------------------------------- */

export interface LegacyExportParams {
	siteId: string;
	range: string;
	type?: string;
	format?: string;
	filters?: string;
}

/**
 * File export → blob download, same request as the old client's exportData():
 * /analytics/export?site_id=&type=&format=&range= (auth via Bearer token).
 * `filters` is sent when present; the deployed worker ignores it today, so
 * exports are scoped by site + range until server support lands.
 */
export const exportLegacyFile = async ({
	siteId,
	range,
	type = "events",
	format = "csv",
	filters = "",
}: LegacyExportParams): Promise<string> => {
	const p = new URLSearchParams({ site_id: siteId, type, format, range });
	if (filters) {
		p.set("filters", filters);
	}
	const token = getToken();
	const res = await fetch(`${LEGACY_API_BASE}/analytics/export?${p}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
	if (!res.ok) {
		throw new Error(`Export failed (${res.status})`);
	}
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	const cd = res.headers.get("Content-Disposition");
	const name = cd?.match(/filename="(.+)"/)?.[1] || `export-${type}.${format}`;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
	return name;
};

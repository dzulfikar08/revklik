/**
 * Client for the production revklik (klikapa) Worker API —
 * segments, annotations, and email reports (settings surface).
 * Port of apps/web/src/lib/legacy/analytics-settings.ts.
 */
import { legacyFetch } from "./api";

/* --------------------------------- types ---------------------------------- */

export interface LegacySegment {
	id: string;
	site_id: string;
	name: string;
	/** JSON-encoded LegacyFilter[]. */
	filters: string;
	created_at: string;
}

export interface LegacyAnnotation {
	id: string;
	site_id: string;
	/** YYYY-MM-DD */
	date: string;
	text: string;
	created_at: string;
}

export interface LegacyEmailReport {
	id: string;
	site_id: string;
	frequency: string;
	/** 1 = enabled, 0 = disabled. */
	enabled: number;
	last_sent: string | null;
	created_at: string;
}

/* -------------------------------- segments -------------------------------- */

export const fetchSegments = (siteId: string): Promise<LegacySegment[]> =>
	legacyFetch(`/segments?site_id=${siteId}`);

export const createSegment = (
	siteId: string,
	name: string,
	filters: { dimension: string; operator: string; value: string }[],
): Promise<{ id: string }> =>
	legacyFetch("/segments", {
		body: JSON.stringify({ filters, name, site_id: siteId }),
		method: "POST",
	});

export const deleteSegment = (id: string): Promise<void> =>
	legacyFetch(`/segments/${id}`, { method: "DELETE" });

/* ------------------------------- annotations ------------------------------- */

export const fetchAnnotations = (siteId: string): Promise<LegacyAnnotation[]> =>
	legacyFetch(`/annotations?site_id=${siteId}`);

export const createAnnotation = (
	siteId: string,
	date: string,
	text: string,
): Promise<{ id: string }> =>
	legacyFetch("/annotations", {
		body: JSON.stringify({ date, site_id: siteId, text }),
		method: "POST",
	});

export const deleteAnnotation = (id: string): Promise<void> =>
	legacyFetch(`/annotations/${id}`, { method: "DELETE" });

/* ------------------------------ email reports ------------------------------ */

export const fetchEmailReports = (siteId: string): Promise<LegacyEmailReport[]> =>
	legacyFetch(`/email-reports?site_id=${siteId}`);

export const createEmailReport = (siteId: string, frequency: string): Promise<{ id: string }> =>
	legacyFetch("/email-reports", {
		body: JSON.stringify({ frequency, site_id: siteId }),
		method: "POST",
	});

export const updateEmailReport = (
	id: string,
	data: { frequency?: string; enabled?: boolean },
): Promise<void> =>
	legacyFetch(`/email-reports/${id}`, {
		body: JSON.stringify(data),
		method: "PUT",
	});

export const deleteEmailReport = (id: string): Promise<void> =>
	legacyFetch(`/email-reports/${id}`, { method: "DELETE" });

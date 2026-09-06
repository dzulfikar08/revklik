/**
 * Site onboarding + management endpoints for the production klikapa Worker API.
 * Port of apps/web/src/lib/legacy/sites.ts minus the DOM blob-download helper
 * (exportLegacyFile) — no <a download> on native.
 */
import { legacyFetch } from "./api";

export interface LegacySite {
  id: string;
  name: string;
  domain: string;
  created_at: string;
}

/* ---------------------------------- sites --------------------------------- */

/** POST /sites — worker requires both name and domain. */
export const createLegacySite = (
  name: string,
  domain: string
): Promise<LegacySite> =>
  legacyFetch("/sites", {
    body: JSON.stringify({ domain, name }),
    method: "POST",
  });

export const deleteLegacySite = (id: string): Promise<void> =>
  legacyFetch(`/sites/${id}`, { method: "DELETE" });

export const fetchSiteSnippet = (
  id: string
): Promise<{ siteId: string; snippet: string }> =>
  legacyFetch(`/sites/${id}/snippet`);

/* -------------------------- self-traffic exclusions ------------------------ */

export const fetchMyFingerprint = (
  siteId: string
): Promise<{ fingerprint: string }> =>
  legacyFetch(`/sites/${siteId}/my-fingerprint`);

export const fetchExclusions = (siteId: string): Promise<string[]> =>
  legacyFetch(`/sites/${siteId}/exclusions`);

export const addExclusion = (
  siteId: string,
  fingerprint?: string
): Promise<string[]> =>
  legacyFetch(`/sites/${siteId}/exclusions`, {
    body: JSON.stringify(fingerprint ? { fingerprint } : {}),
    method: "POST",
  });

export const removeExclusion = (
  siteId: string,
  fp: string
): Promise<string[]> =>
  legacyFetch(`/sites/${siteId}/exclusions/${encodeURIComponent(fp)}`, {
    method: "DELETE",
  });

export const purgeMyVisits = (
  siteId: string,
  fingerprint?: string
): Promise<{ events: number; sessions: number; profiles: number }> =>
  legacyFetch(`/sites/${siteId}/purge`, {
    body: JSON.stringify(fingerprint ? { fingerprint } : {}),
    method: "POST",
  });

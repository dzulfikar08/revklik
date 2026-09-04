/**
 * Site onboarding + management endpoints for the production klikapa Worker API.
 * Shapes mirror the old client (revklik apps/app/src/client/lib/api.ts).
 */
import { LEGACY_API_BASE, getToken, legacyFetch } from "./api";

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
    method: "POST",
    body: JSON.stringify({ name, domain }),
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
    method: "POST",
    body: JSON.stringify(fingerprint ? { fingerprint } : {}),
  });

export const removeExclusion = (siteId: string, fp: string): Promise<string[]> =>
  legacyFetch(`/sites/${siteId}/exclusions/${encodeURIComponent(fp)}`, {
    method: "DELETE",
  });

export const purgeMyVisits = (
  siteId: string,
  fingerprint?: string
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

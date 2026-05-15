import { getToken, getApiBase } from "./config.js";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error || `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiRequest<T>(method: string, path: string, params?: Record<string, string>, body?: any): Promise<T> {
  const token = getToken();
  const base = getApiBase();

  const url = new URL(`${base}/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), options);

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || data.success === false) {
    throw new ApiError(res.status, data);
  }

  return data.data as T;
}

// Resolve a site identifier (full ID, partial ID, or domain) to a full site ID
export async function resolveSite(input: string): Promise<string> {
  // If it looks like a full UUID, return as-is
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    return input;
  }
  const sites = await listSites();
  // Exact domain match
  const byDomain = sites.find((s) => s.domain === input);
  if (byDomain) return byDomain.id;
  // Partial ID match (prefix)
  const byPartial = sites.find((s) => s.id.startsWith(input));
  if (byPartial) return byPartial.id;
  throw new Error(`Site not found: ${input}. Run "revklik sites list" to see available sites.`);
}

// Typed helpers
export async function whoami() {
  return apiRequest<{
    user: { id: string; name: string; email: string };
    plan: string;
    token: { type: "account" | "site"; scopes: string[]; site_id: string | null; name: string; created_at: string };
  }>("GET", "/whoami");
}

export async function listSites() {
  return apiRequest<Array<{ id: string; name: string; domain: string; created_at: string }>>("GET", "/sites");
}

export async function getAnalyticsOverview(siteId: string, range: string) {
  return apiRequest<{
    pageviews: number; visitors: number; sessions: number;
    bounceRate: number; avgDuration: number; revenue: number; conversions: number;
  }>("GET", "/analytics/overview", { site_id: siteId, range });
}

export async function getAnalyticsTimeseries(siteId: string, range: string) {
  return apiRequest<Array<{ date: string; pageviews: number; visitors: number }>>("GET", "/analytics/timeseries", { site_id: siteId, range });
}

export async function getAnalyticsPages(siteId: string, range: string) {
  return apiRequest<Array<{ path: string; pageviews: number; visitors: number }>>("GET", "/analytics/pages", { site_id: siteId, range });
}

export async function getAnalyticsReferrers(siteId: string, range: string) {
  return apiRequest<Array<{ source: string; visitors: number; percentage: number }>>("GET", "/analytics/referrers", { site_id: siteId, range });
}

export async function getAnalyticsGeo(siteId: string, range: string) {
  return apiRequest<Array<{ country: string; region: string; city: string; visitors: number }>>("GET", "/analytics/geo", { site_id: siteId, range });
}

export async function getAnalyticsDevices(siteId: string, range: string) {
  return apiRequest<{
    devices: Array<{ device: string; visitors: number; percentage: number }>;
    os: Array<{ device: string; visitors: number; percentage: number }>;
    browsers: Array<{ device: string; visitors: number; percentage: number }>;
  }>("GET", "/analytics/devices", { site_id: siteId, range });
}

export async function getAnalyticsRevenue(siteId: string, range: string) {
  return apiRequest<{
    bySource: Array<{ source: string; revenue: number; conversions: number }>;
    byCountry: Array<{ country: string; revenue: number; conversions: number }>;
    timeseries: Array<{ date: string; revenue: number; conversions: number }>;
  }>("GET", "/analytics/revenue", { site_id: siteId, range });
}

export async function listTokens() {
  return apiRequest<Array<{
    id: string; prefix: string; name: string; type: "account" | "site";
    scopes: string[]; site_id: string | null; last_used_at: string | null; created_at: string;
  }>>("GET", "/tokens");
}

export async function createToken(params: { name: string; type: "account" | "site"; scopes?: string[]; site_id?: string }) {
  return apiRequest<{
    id: string; token: string; prefix: string; name: string; type: "account" | "site";
    scopes: string[]; site_id: string | null; created_at: string;
  }>("POST", "/tokens", undefined, params);
}

export async function revokeToken(id: string) {
  return apiRequest<void>("DELETE", `/tokens/${id}`);
}

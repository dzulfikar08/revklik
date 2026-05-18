import type { SiteWithStats, AuthResponse, Site, CreateSitePayload, CreateUserPayload, LoginPayload, SiteDashboard, VisitorProfile, ScrollFunnel, Integration, CreateIntegrationPayload, WebhookEventLog, InsightsResponse, PredictionResponse, HeatmapData, RecordingSummary, RecordingDetail, Subscription, PlanInfo, TokenInfo, CreateTokenResponse, SearchQueryData } from "shared";
import { toast } from "@/components/toast";
import { getItem, setItem, removeItem, getItemSync } from "./mobile-storage";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");

async function getToken(): Promise<string | null> { return getItem("kp_token"); }
async function authHeaders(): Promise<Record<string, string>> { const t = await getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  try {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...headers, ...((opts?.headers as Record<string, string>) ?? {}) },
    });
    if (res.status === 401) { await removeItem("kp_token"); window.location.href = "/login"; throw new Error("Session expired"); }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Request failed");
    return json.data as T;
  } catch (err) {
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      toast("Network error — check your connection", "error");
    }
    throw err;
  }
}

// Sync helpers for render-time reads (backed by localStorage, synced to native on write)
export const isLoggedIn = () => !!getItemSync("kp_token");
export const getActiveSiteId = () => getItemSync("kp_active_site");
export const setActiveSiteId = (id: string) => { setItem("kp_active_site", id); };
export const getCurrentUser = () => { try { const r = getItemSync("kp_user"); return r ? JSON.parse(r) : null; } catch { return null; } };

export async function register(p: CreateUserPayload, refCode?: string): Promise<AuthResponse> {
  const path = refCode ? `/auth/register?ref=${encodeURIComponent(refCode)}` : "/auth/register";
  const data = await apiFetch<AuthResponse>(path, { method: "POST", body: JSON.stringify(p) });
  await setItem("kp_token", data.token); await setItem("kp_user", JSON.stringify(data.user));
  return data;
}

export async function login(p: LoginPayload): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(p) });
  await setItem("kp_token", data.token); await setItem("kp_user", JSON.stringify(data.user));
  return data;
}

export function logout() { removeItem("kp_token"); removeItem("kp_user"); removeItem("kp_active_site"); }

export const fetchSites = (range?: string, startDate?: string, endDate?: string) => {
  const p = new URLSearchParams();
  if (startDate && endDate) p.set("range", `${startDate},${endDate}`);
  else if (range) p.set("range", range);
  const qs = p.toString();
  return apiFetch<SiteWithStats[]>(`/sites${qs ? `?${qs}` : ""}`);
};
export const createSite = (p: CreateSitePayload) => apiFetch<Site>("/sites", { method: "POST", body: JSON.stringify(p) });
export const deleteSite = (id: string) => apiFetch<void>(`/sites/${id}`, { method: "DELETE" });
export const fetchSiteSnippet = (id: string) => apiFetch<{ siteId: string; snippet: string }>(`/sites/${id}/snippet`);
export const fetchDashboard = (siteId: string, range?: string, startDate?: string, endDate?: string, filters?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (startDate && endDate) p.set("range", `${startDate},${endDate}`);
  else if (range) p.set("range", range);
  if (filters) p.set("filters", filters);
  return apiFetch<SiteDashboard>(`/analytics/dashboard?${p}`);
};
export const fetchVisitors = (siteId: string) => apiFetch<VisitorProfile[]>(`/analytics/visitors?site_id=${siteId}`);
export const fetchFunnel = (siteId: string, range?: string, filters?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (range) p.set("range", range);
  if (filters) p.set("filters", filters);
  return apiFetch<ScrollFunnel>(`/analytics/funnel?${p}`);
};
export const updateVisitor = (id: string, data: Partial<VisitorProfile>) => apiFetch<void>(`/analytics/visitors/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const fetchGeo = (siteId: string, range?: string, filters?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (range) p.set("range", range);
  if (filters) p.set("filters", filters);
  return apiFetch<{ country: string | null; region: string | null; city: string | null; visitors: number }[]>(`/analytics/geo?${p}`);
};

// Integrations
export const fetchIntegrations = (siteId: string) => apiFetch<Integration[]>(`/integrations?site_id=${siteId}`);
export const createIntegration = (data: CreateIntegrationPayload) => apiFetch<Integration>("/integrations", { method: "POST", body: JSON.stringify(data) });
export const updateIntegration = (id: string, data: Partial<Pick<Integration, "name" | "config" | "enabled">>) => apiFetch<Integration>(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteIntegration = (id: string) => apiFetch<void>(`/integrations/${id}`, { method: "DELETE" });
export const testIntegration = (id: string) => apiFetch<{ ok: boolean; message: string; detail?: string }>(`/integrations/${id}/test`, { method: "POST" });
export const fetchWebhookEvents = (integrationId: string) => apiFetch<WebhookEventLog[]>(`/integrations/${integrationId}/events`);

// Payment Providers
export const fetchPaymentProviders = (siteId: string) =>
  apiFetch<{ id: string; site_id: string; provider: string; config: Record<string, string>; enabled: boolean; created_at: string }[]>(`/payment-providers?site_id=${siteId}`);

export const createPaymentProvider = (siteId: string, provider: string, config: Record<string, string>) =>
  apiFetch<{ id: string; provider: string; enabled: boolean }>("/payment-providers", {
    method: "POST",
    body: JSON.stringify({ site_id: siteId, provider, config }),
    headers: { "Content-Type": "application/json" },
  });

export const deletePaymentProvider = (siteId: string, provider: string) =>
  apiFetch<void>(`/payment-providers/${provider}?site_id=${siteId}`, { method: "DELETE" });

// AI Insights
export const fetchInsights = (siteId: string, range?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (range) p.set("range", range);
  return apiFetch<InsightsResponse>(`/ai-insights?${p}`);
};
export const refreshInsights = (siteId: string, range?: string) => apiFetch<InsightsResponse>("/ai-insights/refresh", { method: "POST", body: JSON.stringify({ site_id: siteId, range: range || "7d" }) });

// Heatmaps
export const fetchHeatmap = (siteId: string, path: string, range?: string) => {
  const p = new URLSearchParams({ site_id: siteId, path, range: range || "7d" });
  return apiFetch<HeatmapData>(`/analytics/heatmap?${p}`);
};
export const fetchRecordings = (siteId: string, range?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (range) p.set("range", range);
  return apiFetch<RecordingSummary[]>(`/analytics/recordings?${p}`);
};
export const fetchRecording = (id: string) => apiFetch<RecordingDetail>(`/analytics/recordings/${id}`);

// SSE real-time connection
export function connectSSE(
  siteId: string,
  onEvent: (event: { type: string; data: unknown }) => void,
): () => void {
  let aborted = false;
  let reconnectTimer: ReturnType<typeof setTimeout>;

  const connect = async () => {
    if (aborted) return;
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/analytics/stream?site_id=${siteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || !res.body) { scheduleReconnect(); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) {
            try { onEvent({ type: eventType, data: JSON.parse(line.slice(6)) }); } catch {}
            eventType = "";
          }
        }
      }
    } catch { /* ignore */ }
    if (!aborted) scheduleReconnect();
  };

  const scheduleReconnect = () => { reconnectTimer = setTimeout(connect, 3000); };

  connect();
  return () => { aborted = true; clearTimeout(reconnectTimer); };
}

// Data export
export async function exportData(siteId: string, type: string, format: string, range: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/analytics/export?site_id=${siteId}&type=${type}&format=${format}&range=${range}`, {
    headers,
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cd = res.headers.get("Content-Disposition");
  a.download = cd?.match(/filename="(.+)"/)?.[1] || `export-${type}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// Billing
export const fetchSubscription = () => apiFetch<Subscription>("/billing/subscription");
export const fetchPlans = () => apiFetch<PlanInfo[]>("/billing/plans");
export const createCheckout = (plan: string) => apiFetch<{ url: string }>("/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
export const cancelSubscription = () => apiFetch<void>("/billing/cancel", { method: "POST" });

// Data import
export const importPolarOrders = (siteId: string, polarToken: string, polarOrgId?: string) => apiFetch<{ imported: number; skipped: number }>("/import/polar-orders", { method: "POST", body: JSON.stringify({ site_id: siteId, polar_token: polarToken, polar_org_id: polarOrgId }) });
export const importOneDollarStats = (siteId: string, apiKey: string, odsSiteId: string, dateRange?: string) => apiFetch<{ imported: number; note: string }>("/import/onedollarstats", { method: "POST", body: JSON.stringify({ site_id: siteId, api_key: apiKey, ods_site_id: odsSiteId, date_range: dateRange || "all" }) });

// API Token management
export const fetchTokens = () => apiFetch<TokenInfo[]>("/tokens");
export const createApiToken = (data: { name: string; type: "account" | "site"; scopes?: string[]; site_id?: string }) => apiFetch<CreateTokenResponse>("/tokens", { method: "POST", body: JSON.stringify(data) });
export const revokeApiToken = (id: string) => apiFetch<void>(`/tokens/${id}`, { method: "DELETE" });

// Segments
export const fetchSegments = (siteId: string) => apiFetch<{ id: string; site_id: string; name: string; filters: string; created_at: string }[]>(`/segments?site_id=${siteId}`);
export const createSegment = (siteId: string, name: string, filters: { dimension: string; operator: string; value: string }[]) =>
  apiFetch<{ id: string }>("/segments", { method: "POST", body: JSON.stringify({ site_id: siteId, name, filters }) });
export const deleteSegment = (id: string) => apiFetch<void>(`/segments/${id}`, { method: "DELETE" });

// Annotations
export const fetchAnnotations = (siteId: string) => apiFetch<{ id: string; site_id: string; date: string; text: string; created_at: string }[]>(`/annotations?site_id=${siteId}`);
export const createAnnotation = (siteId: string, date: string, text: string) =>
  apiFetch<{ id: string }>("/annotations", { method: "POST", body: JSON.stringify({ site_id: siteId, date, text }) });
export const deleteAnnotation = (id: string) => apiFetch<void>(`/annotations/${id}`, { method: "DELETE" });

// Email Reports
export const fetchEmailReports = (siteId: string) => apiFetch<{ id: string; site_id: string; frequency: string; enabled: number; last_sent: string | null; created_at: string }[]>(`/email-reports?site_id=${siteId}`);
export const createEmailReport = (siteId: string, frequency: string) =>
  apiFetch<{ id: string }>("/email-reports", { method: "POST", body: JSON.stringify({ site_id: siteId, frequency }) });
export const updateEmailReport = (id: string, data: { frequency?: string; enabled?: boolean }) =>
  apiFetch<void>(`/email-reports/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteEmailReport = (id: string) => apiFetch<void>(`/email-reports/${id}`, { method: "DELETE" });

// Public Dashboard Sharing
export const togglePublicDashboard = (siteId: string) =>
  apiFetch<{ public: boolean; share_token: string | null }>(`/share/${siteId}/toggle`, { method: "POST" });
export const fetchShareStatus = (siteId: string) =>
  apiFetch<{ public: boolean; share_token: string | null }>(`/share/${siteId}/status`);

// Google Search Console
export const fetchSearchQueries = (siteId: string): Promise<SearchQueryData[]> =>
  apiFetch(`/gsc/queries?site_id=${siteId}`);
export const syncGSC = (siteId: string): Promise<void> =>
  apiFetch(`/gsc/sync?site_id=${siteId}`, { method: "POST" });

// Revenue Predictions
export const fetchPredictions = (siteId: string): Promise<PredictionResponse> =>
  apiFetch(`/predictions?site_id=${siteId}`);
export const refreshPredictions = (siteId: string): Promise<PredictionResponse> =>
  apiFetch(`/predictions/refresh?site_id=${siteId}`, { method: "POST" });

// Affiliate
export const fetchAffiliate = () => apiFetch("/affiliates/me");
export const generateReferralCode = () => apiFetch("/affiliates/generate-code", { method: "POST" });
export const fetchAffiliateReferrals = () => apiFetch("/affiliates/referrals");
export const fetchAffiliateStats = () => apiFetch("/affiliates/stats");

export const getGSCAuthUrl = (siteId: string): string => {
  const base = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");
  return `${base}/gsc/auth?site_id=${siteId}`;
};

// Marketplace (Shopee / Tokopedia)
export const getShopeeAuthUrl = (siteId: string): string => {
  const base = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");
  return `${base}/marketplace/shopee/auth?site_id=${siteId}`;
};
export const getTokopediaAuthUrl = (siteId: string): string => {
  const base = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");
  return `${base}/marketplace/tokopedia/auth?site_id=${siteId}`;
};
export const syncShopeeOrders = (siteId: string) =>
  apiFetch(`/marketplace/shopee/sync?site_id=${siteId}`, { method: "POST" });
export const fetchShopeeOrders = (siteId: string) =>
  apiFetch(`/marketplace/shopee/orders?site_id=${siteId}`);
export const syncTokopediaOrders = (siteId: string) =>
  apiFetch(`/marketplace/tokopedia/sync?site_id=${siteId}`, { method: "POST" });
export const fetchTokopediaOrders = (siteId: string) =>
  apiFetch(`/marketplace/tokopedia/orders?site_id=${siteId}`);

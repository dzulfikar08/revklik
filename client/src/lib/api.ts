import type { SiteWithStats, AuthResponse, Site, CreateSitePayload, CreateUserPayload, LoginPayload, SiteDashboard, VisitorProfile, ScrollFunnel, Integration, CreateIntegrationPayload, WebhookEventLog, InsightsResponse, HeatmapData, RecordingSummary, RecordingDetail, Subscription, PlanInfo } from "shared";
import { toast } from "@/components/toast";

const API_BASE = import.meta.env.DEV ? "http://localhost:3000/api" : "/api";

function getToken(): string | null { return localStorage.getItem("kp_token"); }
function authHeaders(): Record<string, string> { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...((opts?.headers as Record<string, string>) ?? {}) },
    });
    if (res.status === 401) { localStorage.removeItem("kp_token"); window.location.href = "/login"; throw new Error("Session expired"); }
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

export const isLoggedIn = () => !!getToken();
export const getActiveSiteId = () => localStorage.getItem("kp_active_site");
export const setActiveSiteId = (id: string) => localStorage.setItem("kp_active_site", id);
export const getCurrentUser = () => { const r = localStorage.getItem("kp_user"); return r ? JSON.parse(r) : null; };

export async function register(p: CreateUserPayload): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(p) });
  localStorage.setItem("kp_token", data.token); localStorage.setItem("kp_user", JSON.stringify(data.user));
  return data;
}

export async function login(p: LoginPayload): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(p) });
  localStorage.setItem("kp_token", data.token); localStorage.setItem("kp_user", JSON.stringify(data.user));
  return data;
}

export function logout() { localStorage.removeItem("kp_token"); localStorage.removeItem("kp_user"); localStorage.removeItem("kp_active_site"); }

export const fetchSites = () => apiFetch<SiteWithStats[]>("/sites");
export const createSite = (p: CreateSitePayload) => apiFetch<Site>("/sites", { method: "POST", body: JSON.stringify(p) });
export const deleteSite = (id: string) => apiFetch<void>(`/sites/${id}`, { method: "DELETE" });
export const fetchSiteSnippet = (id: string) => apiFetch<{ siteId: string; snippet: string }>(`/sites/${id}/snippet`);
export const fetchDashboard = (siteId: string, range?: string, startDate?: string, endDate?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (startDate && endDate) p.set("range", `${startDate},${endDate}`);
  else if (range) p.set("range", range);
  return apiFetch<SiteDashboard>(`/analytics/dashboard?${p}`);
};
export const fetchVisitors = (siteId: string) => apiFetch<VisitorProfile[]>(`/analytics/visitors?site_id=${siteId}`);
export const fetchFunnel = (siteId: string, range?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (range) p.set("range", range);
  return apiFetch<ScrollFunnel>(`/analytics/funnel?${p}`);
};
export const updateVisitor = (id: string, data: Partial<VisitorProfile>) => apiFetch<void>(`/analytics/visitors/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const fetchGeo = (siteId: string, range?: string) => {
  const p = new URLSearchParams({ site_id: siteId });
  if (range) p.set("range", range);
  return apiFetch<{ country: string | null; region: string | null; city: string | null; visitors: number }[]>(`/analytics/geo?${p}`);
};

// Integrations
export const fetchIntegrations = (siteId: string) => apiFetch<Integration[]>(`/integrations?site_id=${siteId}`);
export const createIntegration = (data: CreateIntegrationPayload) => apiFetch<Integration>("/integrations", { method: "POST", body: JSON.stringify(data) });
export const updateIntegration = (id: string, data: Partial<Pick<Integration, "name" | "config" | "enabled">>) => apiFetch<Integration>(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteIntegration = (id: string) => apiFetch<void>(`/integrations/${id}`, { method: "DELETE" });
export const testIntegration = (id: string) => apiFetch<{ ok: boolean; message: string; detail?: string }>(`/integrations/${id}/test`, { method: "POST" });
export const fetchWebhookEvents = (integrationId: string) => apiFetch<WebhookEventLog[]>(`/integrations/${integrationId}/events`);

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
  const token = getToken();
  if (!token) return () => {};

  const base = import.meta.env.DEV ? "http://localhost:3000/api" : "/api";
  let aborted = false;
  let reconnectTimer: ReturnType<typeof setTimeout>;

  const connect = async () => {
    if (aborted) return;
    try {
      const res = await fetch(`${base}/analytics/stream?site_id=${siteId}`, {
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
  const base = import.meta.env.DEV ? "http://localhost:3000/api" : "/api";
  const res = await fetch(`${base}/analytics/export?site_id=${siteId}&type=${type}&format=${format}&range=${range}`, {
    headers: authHeaders(),
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

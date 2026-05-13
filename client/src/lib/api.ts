import type { SiteWithStats, AuthResponse, Site, CreateSitePayload, CreateUserPayload, LoginPayload, SiteDashboard, VisitorProfile } from "shared";

const API_BASE = import.meta.env.DEV ? "http://localhost:3000/api" : "/api";

function getToken(): string | null { return localStorage.getItem("kp_token"); }
function authHeaders(): Record<string, string> { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...((opts?.headers as Record<string, string>) ?? {}) },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Request failed");
  return json.data as T;
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
export const updateVisitor = (id: string, data: Partial<VisitorProfile>) => apiFetch<void>(`/analytics/visitors/${id}`, { method: "PATCH", body: JSON.stringify(data) });

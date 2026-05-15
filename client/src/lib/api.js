import { toast } from "@/components/toast";
import { getItem, setItem, removeItem, getItemSync } from "./mobile-storage";
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");
async function getToken() { return getItem("kp_token"); }
async function authHeaders() { const t = await getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }
async function apiFetch(path, opts) {
    try {
        const headers = await authHeaders();
        const res = await fetch(`${API_BASE}${path}`, {
            ...opts,
            headers: { "Content-Type": "application/json", ...headers, ...(opts?.headers ?? {}) },
        });
        if (res.status === 401) {
            await removeItem("kp_token");
            window.location.href = "/login";
            throw new Error("Session expired");
        }
        const json = await res.json();
        if (!json.success)
            throw new Error(json.error || "Request failed");
        return json.data;
    }
    catch (err) {
        if (err instanceof TypeError && err.message === "Failed to fetch") {
            toast("Network error — check your connection", "error");
        }
        throw err;
    }
}
// Sync helpers for render-time reads (backed by localStorage, synced to native on write)
export const isLoggedIn = () => !!getItemSync("kp_token");
export const getActiveSiteId = () => getItemSync("kp_active_site");
export const setActiveSiteId = (id) => { setItem("kp_active_site", id); };
export const getCurrentUser = () => { const r = getItemSync("kp_user"); return r ? JSON.parse(r) : null; };
export async function register(p) {
    const data = await apiFetch("/auth/register", { method: "POST", body: JSON.stringify(p) });
    await setItem("kp_token", data.token);
    await setItem("kp_user", JSON.stringify(data.user));
    return data;
}
export async function login(p) {
    const data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(p) });
    await setItem("kp_token", data.token);
    await setItem("kp_user", JSON.stringify(data.user));
    return data;
}
export function logout() { removeItem("kp_token"); removeItem("kp_user"); removeItem("kp_active_site"); }
export const fetchSites = () => apiFetch("/sites");
export const createSite = (p) => apiFetch("/sites", { method: "POST", body: JSON.stringify(p) });
export const deleteSite = (id) => apiFetch(`/sites/${id}`, { method: "DELETE" });
export const fetchSiteSnippet = (id) => apiFetch(`/sites/${id}/snippet`);
export const fetchDashboard = (siteId, range, startDate, endDate) => {
    const p = new URLSearchParams({ site_id: siteId });
    if (startDate && endDate)
        p.set("range", `${startDate},${endDate}`);
    else if (range)
        p.set("range", range);
    return apiFetch(`/analytics/dashboard?${p}`);
};
export const fetchVisitors = (siteId) => apiFetch(`/analytics/visitors?site_id=${siteId}`);
export const fetchFunnel = (siteId, range) => {
    const p = new URLSearchParams({ site_id: siteId });
    if (range)
        p.set("range", range);
    return apiFetch(`/analytics/funnel?${p}`);
};
export const updateVisitor = (id, data) => apiFetch(`/analytics/visitors/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const fetchGeo = (siteId, range) => {
    const p = new URLSearchParams({ site_id: siteId });
    if (range)
        p.set("range", range);
    return apiFetch(`/analytics/geo?${p}`);
};
// Integrations
export const fetchIntegrations = (siteId) => apiFetch(`/integrations?site_id=${siteId}`);
export const createIntegration = (data) => apiFetch("/integrations", { method: "POST", body: JSON.stringify(data) });
export const updateIntegration = (id, data) => apiFetch(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteIntegration = (id) => apiFetch(`/integrations/${id}`, { method: "DELETE" });
export const testIntegration = (id) => apiFetch(`/integrations/${id}/test`, { method: "POST" });
export const fetchWebhookEvents = (integrationId) => apiFetch(`/integrations/${integrationId}/events`);
// AI Insights
export const fetchInsights = (siteId, range) => {
    const p = new URLSearchParams({ site_id: siteId });
    if (range)
        p.set("range", range);
    return apiFetch(`/ai-insights?${p}`);
};
export const refreshInsights = (siteId, range) => apiFetch("/ai-insights/refresh", { method: "POST", body: JSON.stringify({ site_id: siteId, range: range || "7d" }) });
// Heatmaps
export const fetchHeatmap = (siteId, path, range) => {
    const p = new URLSearchParams({ site_id: siteId, path, range: range || "7d" });
    return apiFetch(`/analytics/heatmap?${p}`);
};
export const fetchRecordings = (siteId, range) => {
    const p = new URLSearchParams({ site_id: siteId });
    if (range)
        p.set("range", range);
    return apiFetch(`/analytics/recordings?${p}`);
};
export const fetchRecording = (id) => apiFetch(`/analytics/recordings/${id}`);
// SSE real-time connection
export function connectSSE(siteId, onEvent) {
    let aborted = false;
    let reconnectTimer;
    const connect = async () => {
        if (aborted)
            return;
        const token = await getToken();
        if (!token)
            return;
        try {
            const res = await fetch(`${API_BASE}/analytics/stream?site_id=${siteId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok || !res.body) {
                scheduleReconnect();
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (!aborted) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                let eventType = "";
                for (const line of lines) {
                    if (line.startsWith("event: "))
                        eventType = line.slice(7);
                    else if (line.startsWith("data: ")) {
                        try {
                            onEvent({ type: eventType, data: JSON.parse(line.slice(6)) });
                        }
                        catch { }
                        eventType = "";
                    }
                }
            }
        }
        catch { /* ignore */ }
        if (!aborted)
            scheduleReconnect();
    };
    const scheduleReconnect = () => { reconnectTimer = setTimeout(connect, 3000); };
    connect();
    return () => { aborted = true; clearTimeout(reconnectTimer); };
}
// Data export
export async function exportData(siteId, type, format, range) {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/analytics/export?site_id=${siteId}&type=${type}&format=${format}&range=${range}`, {
        headers,
    });
    if (!res.ok)
        throw new Error("Export failed");
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
export const fetchSubscription = () => apiFetch("/billing/subscription");
export const fetchPlans = () => apiFetch("/billing/plans");
export const createCheckout = (plan) => apiFetch("/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
export const cancelSubscription = () => apiFetch("/billing/cancel", { method: "POST" });
// Data import
export const importPolarOrders = (siteId, polarToken, polarOrgId) => apiFetch("/import/polar-orders", { method: "POST", body: JSON.stringify({ site_id: siteId, polar_token: polarToken, polar_org_id: polarOrgId }) });
export const importOneDollarStats = (siteId, apiKey, odsSiteId, dateRange) => apiFetch("/import/onedollarstats", { method: "POST", body: JSON.stringify({ site_id: siteId, api_key: apiKey, ods_site_id: odsSiteId, date_range: dateRange || "all" }) });

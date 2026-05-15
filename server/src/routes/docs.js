import { Hono } from "hono";
export const docsRoutes = new Hono();
const endpoints = [
    { method: "POST", path: "/api/auth/register", auth: false, desc: "Register new user", body: "{ name, email, password }" },
    { method: "POST", path: "/api/auth/login", auth: false, desc: "Login", body: "{ email, password }" },
    { method: "GET", path: "/api/sites", auth: true, desc: "List your sites" },
    { method: "POST", path: "/api/sites", auth: true, desc: "Create site", body: "{ name, domain }" },
    { method: "DELETE", path: "/api/sites/:id", auth: true, desc: "Delete site" },
    { method: "GET", path: "/api/analytics/dashboard", auth: true, desc: "Dashboard stats", query: "site_id, range, start_date, end_date" },
    { method: "GET", path: "/api/analytics/visitors", auth: true, desc: "Visitor profiles", query: "site_id" },
    { method: "GET", path: "/api/analytics/funnel", auth: true, desc: "Scroll funnel", query: "site_id, range" },
    { method: "GET", path: "/api/analytics/geo", auth: true, desc: "Geo data", query: "site_id, range" },
    { method: "GET", path: "/api/analytics/heatmap", auth: true, desc: "Heatmap data", query: "site_id, path, range" },
    { method: "GET", path: "/api/analytics/recordings", auth: true, desc: "Session recordings", query: "site_id, range" },
    { method: "GET", path: "/api/analytics/stream", auth: true, desc: "SSE real-time stream", query: "site_id" },
    { method: "GET", path: "/api/analytics/export", auth: true, desc: "Export data (CSV/JSON)", query: "site_id, type(events|visitors|sessions), format(csv|json), range" },
    { method: "GET", path: "/api/ai-insights", auth: true, desc: "AI insights", query: "site_id, range" },
    { method: "POST", path: "/api/ai-insights/refresh", auth: true, desc: "Regenerate insights", body: "{ site_id, range }" },
    { method: "GET", path: "/api/integrations", auth: true, desc: "List integrations", query: "site_id" },
    { method: "POST", path: "/api/integrations", auth: true, desc: "Create integration", body: "{ site_id, type, name, config }" },
    { method: "PATCH", path: "/api/integrations/:id", auth: true, desc: "Update integration" },
    { method: "DELETE", path: "/api/integrations/:id", auth: true, desc: "Delete integration" },
    { method: "POST", path: "/api/integrations/:id/test", auth: true, desc: "Test integration" },
    { method: "GET", path: "/api/billing/subscription", auth: true, desc: "Current subscription" },
    { method: "GET", path: "/api/billing/plans", auth: true, desc: "Available plans" },
    { method: "POST", path: "/api/billing/checkout", auth: true, desc: "Create checkout", body: "{ plan }" },
    { method: "POST", path: "/api/billing/cancel", auth: true, desc: "Cancel subscription" },
    { method: "GET", path: "/api/team", auth: true, desc: "List team members", query: "site_id" },
    { method: "POST", path: "/api/team/invite", auth: true, desc: "Invite member", body: "{ site_id, email, role }" },
    { method: "PATCH", path: "/api/team/:memberId", auth: true, desc: "Update role", body: "{ role }" },
    { method: "DELETE", path: "/api/team/:memberId", auth: true, desc: "Remove member" },
    { method: "POST", path: "/api/track", auth: false, desc: "Track events (batch)", note: "See tracking script for payload format" },
    { method: "POST", path: "/api/track/heatmap", auth: false, desc: "Heatmap data", note: "Requires site_id, sid, vid" },
    { method: "POST", path: "/api/track/recording", auth: false, desc: "Session recording chunk" },
    { method: "POST", path: "/api/webhooks/mailchimp", auth: false, desc: "Mailchimp webhook", query: "site_id" },
    { method: "POST", path: "/api/webhooks/convertkit", auth: false, desc: "ConvertKit webhook", query: "site_id" },
    { method: "POST", path: "/api/webhooks/kit", auth: false, desc: "Kit webhook", query: "site_id" },
    { method: "POST", path: "/api/webhooks/beehiiv", auth: false, desc: "Beehiiv webhook", query: "site_id" },
    { method: "POST", path: "/api/billing/webhook", auth: false, desc: "Polar webhook (internal)" },
];
docsRoutes.get("/", (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KlikApa API Documentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e8e4de; padding: 40px 20px; }
    .wrap { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; color: #d4882a; }
    h2 { font-size: 18px; margin: 32px 0 12px; color: #a8a29e; }
    p.sub { color: #6b6560; font-size: 14px; margin-bottom: 24px; }
    .endpoint { display: flex; align-items: baseline; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1c1c1c; font-size: 14px; }
    .method { font-family: monospace; font-weight: 700; font-size: 12px; padding: 3px 8px; border-radius: 4px; min-width: 52px; text-align: center; }
    .get { background: rgba(96,165,250,.12); color: #60a5fa; }
    .post { background: rgba(52,211,153,.12); color: #34d399; }
    .patch { background: rgba(212,136,42,.12); color: #d4882a; }
    .delete { background: rgba(239,68,68,.12); color: #ef4444; }
    .path { font-family: monospace; color: #e8e4de; }
    .desc { color: #6b6560; margin-left: auto; white-space: nowrap; }
    .auth { font-size: 10px; background: rgba(167,139,250,.12); color: #a78bfa; padding: 2px 6px; border-radius: 3px; }
    .no-auth { font-size: 10px; background: rgba(107,101,96,.12); color: #6b6560; padding: 2px 6px; border-radius: 3px; }
    code { font-family: monospace; font-size: 12px; background: #161616; padding: 2px 6px; border-radius: 3px; color: #a8a29e; }
    .base { margin: 16px 0; padding: 12px 16px; background: #111; border-radius: 8px; border: 1px solid #222; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>KlikApa API</h1>
    <p class="sub">Privacy-first analytics platform. All authenticated endpoints require <code>Authorization: Bearer &lt;token&gt;</code></p>
    <div class="base"><strong>Base URL:</strong> <code>https://app.revklik.com/api</code></div>
    <h2>Authentication</h2>
    <p style="font-size:14px;color:#a8a29e;line-height:1.6;margin-bottom:16px;">
      Obtain a token via <code>POST /auth/register</code> or <code>POST /auth/login</code>.
      Include it as <code>Authorization: Bearer &lt;token&gt;</code> in all authenticated requests.
    </p>
    <h2>Endpoints</h2>
    ${endpoints.map(e => `<div class="endpoint">
      <span class="method ${e.method.toLowerCase()}">${e.method}</span>
      <span class="path">${e.path}</span>
      ${e.auth ? '<span class="auth">Auth</span>' : '<span class="no-auth">Public</span>'}
      <span class="desc">${e.desc}</span>
    </div>`).join("")}
    <h2 style="margin-top:40px">Tracking Payload</h2>
    <div class="base" style="font-family:monospace;font-size:12px;line-height:1.8;white-space:pre;color:#a8a29e;">
{
  "s": "site_id",
  "sid": "session_id",
  "vid": "visitor_id",
  "t": "p" | "c" | "e",  // pageview, conversion, custom
  "n": "event_name",
  "p": "/path",
  "h": "hostname",
  "r": "referrer",
  "us": "utm_source",
  "um": "utm_medium",
  "uc": "utm_campaign",
  "rv": 0,   // revenue
  "ts": 0,   // timestamp ms
  "dv": "desktop|mobile|tablet",
  "br": "Chrome",
  "os": "macOS"
}</div>
  </div>
</body>
</html>`;
    return c.html(html);
});
docsRoutes.get("/openapi.json", (c) => {
    return c.json({
        openapi: "3.1.0",
        info: { title: "KlikApa API", version: "1.0.0", description: "Privacy-first analytics platform API" },
        servers: [{ url: "https://app.revklik.com/api" }],
        components: {
            securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        },
        paths: Object.fromEntries(endpoints.map(e => [e.path, {
                [e.method.toLowerCase()]: {
                    summary: e.desc,
                    security: e.auth ? [{ bearerAuth: [] }] : [],
                    ...(e.query ? { parameters: e.query.split(", ").map(p => ({ name: p.trim(), in: "query", required: p.includes("site_id"), schema: { type: "string" } })) } : {}),
                    ...(e.body ? { requestBody: { content: { "application/json": { schema: { type: "object" } } } } } : {}),
                    responses: { "200": { description: "Success" }, "400": { description: "Bad request" }, "401": { description: "Unauthorized" } },
                },
            }])),
    });
});

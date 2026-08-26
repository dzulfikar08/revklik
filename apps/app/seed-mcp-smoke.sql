-- Seed for local MCP smoke test (dev D1 only)
INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES
('u_smoke', 'smoke@revklik.test', 'Smoke Tester', 'x', 'user', '2026-08-01T00:00:00Z');

INSERT INTO sites (id, user_id, name, domain, created_at) VALUES
('site_smoke', 'u_smoke', 'Smoke Site', 'smoke.test', '2026-08-01T00:00:00Z'),
('site_other', 'u_smoke', 'Other Site', 'other.test', '2026-08-02T00:00:00Z');

INSERT INTO subscriptions (id, user_id, plan, status, created_at, updated_at) VALUES
('sub_smoke', 'u_smoke', 'growth', 'active', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');

-- rvt_ account token (all scopes) / rv_ site token bound to site_smoke
INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id, created_at) VALUES
('key_acct', 'u_smoke', 'f639bf45875fe88ad5a794f622bc9b2821ed8b5e07b06184047ec4cc77bf362d', 'rvt_af5', 'mcp smoke account', 'account', '["sites:read","analytics:read","analytics:export","tokens:read","tokens:write"]', NULL, '2026-08-20T00:00:00Z'),
('key_site', 'u_smoke', '861f44444d61a4b1ab38a56572fdb9ad3324300f1f028da9baea9dfbd5a83b02', 'rv_a5d0', 'mcp smoke site', 'site', '["analytics:read","analytics:export"]', 'site_smoke', '2026-08-20T00:00:00Z');

INSERT INTO visitor_profiles (id, site_id, visitor_id, name, email, first_seen, last_seen, total_sessions, total_pageviews, total_revenue) VALUES
('vp_1', 'site_smoke', 'vis_1', 'Budi', 'budi@smoke.test', '2026-08-25T00:00:00Z', '2026-08-26T00:00:00Z', 2, 5, 150000),
('vp_2', 'site_smoke', 'vis_2', NULL, NULL, '2026-08-25T00:00:00Z', '2026-08-26T00:00:00Z', 1, 2, 0);

INSERT INTO sessions (id, site_id, visitor_id, started_at, ended_at, entry_path, exit_path, referrer, utm_source, country, region, city, device_type, browser, os, page_count, is_bounce) VALUES
('ses_1', 'site_smoke', 'vis_1', '2026-08-26T10:00:00Z', '2026-08-26T10:05:00Z', '/', '/pricing', 'https://google.com/', 'google', 'ID', 'JK', 'Jakarta', 'desktop', 'chrome', 'windows', 3, 0),
('ses_2', 'site_smoke', 'vis_2', '2026-08-26T11:00:00Z', '2026-08-26T11:01:00Z', '/', '/', NULL, NULL, 'SG', NULL, 'Singapore', 'mobile', 'safari', 'ios', 1, 1);

INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, hostname, referrer, utm_source, utm_medium, utm_campaign, country, region, city, device_type, browser, os, revenue, props) VALUES
('ev_1', 'site_smoke', 'ses_1', 'vis_1', '2026-08-26T10:00:00Z', 'pageview', NULL, '/', 'smoke.test', 'https://google.com/', 'google', 'cpc', 'ramadan-sale', 'ID', 'JK', 'Jakarta', 'desktop', 'chrome', 'windows', NULL, NULL),
('ev_2', 'site_smoke', 'ses_1', 'vis_1', '2026-08-26T10:02:00Z', 'pageview', NULL, '/pricing', 'smoke.test', NULL, 'google', 'cpc', 'ramadan-sale', 'ID', 'JK', 'Jakarta', 'desktop', 'chrome', 'windows', NULL, NULL),
('ev_3', 'site_smoke', 'ses_1', 'vis_1', '2026-08-26T10:05:00Z', 'conversion', 'purchase', '/checkout', 'smoke.test', NULL, 'google', 'cpc', 'ramadan-sale', 'ID', 'JK', 'Jakarta', 'desktop', 'chrome', 'windows', 150000, '{"order_id":"ORD-1","payment_provider":"midtrans"}'),
('ev_4', 'site_smoke', 'ses_2', 'vis_2', '2026-08-26T11:00:00Z', 'pageview', NULL, '/', 'smoke.test', NULL, NULL, NULL, NULL, 'SG', NULL, 'Singapore', 'mobile', 'safari', 'ios', NULL, NULL),
('ev_5', 'site_smoke', 'ses_2', 'vis_2', '2026-08-26T11:01:00Z', 'custom', 'signup_click', '/', 'smoke.test', NULL, NULL, NULL, NULL, 'SG', NULL, 'Singapore', 'mobile', 'safari', 'ios', NULL, '{"cta":"header"}');

import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createApp } from "../app";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { ROLE_TABLE, type SiteAction, type SiteRole } from "../lib/site-roles";

/**
 * Every mutating route, called as every kind of caller. This is the guard against the
 * copy-pasted access checks drifting again: a new mutating route that is not classified
 * below fails the census, and a site route that lets a viewer or stranger through fails
 * the matrix.
 */

const SITE = "s-matrix";
type Caller = "stranger" | "pending" | SiteRole;
const CALLERS: Caller[] = ["stranger", "pending", "viewer", "editor", "admin", "owner"];

interface SiteRoute {
	method: "POST" | "PUT" | "PATCH" | "DELETE";
	/** Registered path pattern, as in app.routes. */
	pattern: string;
	/** Concrete URL to call. */
	url: string;
	/** Lowest role that may do this. */
	min: SiteAction;
	body?: unknown;
	/** Re-create the row the route targets before every call (deletes consume it). */
	seed?: (db: Database) => void;
	/** Runs for the owner only, after everyone else: it destroys the site. */
	destructive?: boolean;
}

const now = new Date().toISOString();

/** Handlers that call out (GSC, importer, webhooks) get a failing upstream, never the network. */
const offlineFetch = Object.assign(async () => new Response("{}", { status: 502 }), {
	preconnect: () => {},
});

const seedAnnotation = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO annotations (id, site_id, date, text, user_id) VALUES ('an-1', ?, '2026-01-01', 'x', 'u-owner')",
		)
		.run(SITE);
const seedSegment = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO segments (id, site_id, name, filters) VALUES ('sg-1', ?, 'n', '{}')",
		)
		.run(SITE);
const seedReport = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO email_reports (id, site_id, user_id, frequency) VALUES ('er-1', ?, 'u-owner', 'weekly')",
		)
		.run(SITE);
const seedIntegration = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO integrations (id, site_id, user_id, type, name, config) VALUES ('in-1', ?, 'u-owner', 'mailchimp', 'n', '{}')",
		)
		.run(SITE);
const seedProvider = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO payment_providers (id, site_id, provider, config) VALUES ('pp-x', ?, 'xendit', '{\"webhook_secret\":\"s\"}')",
		)
		.run(SITE);
const seedVisitor = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO visitor_profiles (id, site_id, visitor_id) VALUES ('vp-1', ?, 'vid-1')",
		)
		.run(SITE);
const seedMember = (db: Database) =>
	db
		.prepare(
			"INSERT OR REPLACE INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES ('tm-spare', ?, 'u-stranger', 'viewer', 'u-owner', ?, ?)",
		)
		.run(SITE, now, now);

const SITE_ROUTES: SiteRoute[] = [
	{
		method: "POST",
		pattern: "/api/annotations",
		url: "/api/annotations",
		min: "write",
		body: { site_id: SITE, date: "2026-01-02", text: "launch" },
	},
	{
		method: "DELETE",
		pattern: "/api/annotations/:annotationId",
		url: "/api/annotations/an-1",
		min: "write",
		seed: seedAnnotation,
	},
	{
		method: "POST",
		pattern: "/api/segments",
		url: "/api/segments",
		min: "write",
		body: { site_id: SITE, name: "seg", filters: [] },
	},
	{
		method: "DELETE",
		pattern: "/api/segments/:segmentId",
		url: "/api/segments/sg-1",
		min: "write",
		seed: seedSegment,
	},
	{
		method: "POST",
		pattern: "/api/email-reports",
		url: "/api/email-reports",
		min: "write",
		body: { site_id: SITE, frequency: "weekly" },
	},
	{
		method: "PUT",
		pattern: "/api/email-reports/:reportId",
		url: "/api/email-reports/er-1",
		min: "write",
		body: { enabled: false },
		seed: seedReport,
	},
	{
		method: "DELETE",
		pattern: "/api/email-reports/:reportId",
		url: "/api/email-reports/er-1",
		min: "write",
		seed: seedReport,
	},
	{
		method: "PATCH",
		pattern: "/api/analytics/visitors/:visitorId",
		url: "/api/analytics/visitors/vp-1",
		min: "write",
		body: { notes: "vip", tags: "a,b" },
		seed: seedVisitor,
	},
	{
		// GDPR erasure: viewers may read the export but not erase.
		method: "DELETE",
		pattern: "/api/sites/:siteId/visitors/:visitorId",
		url: `/api/sites/${SITE}/visitors/vid-1`,
		min: "write",
		seed: seedVisitor,
	},
	{
		method: "POST",
		pattern: "/api/ai-insights/refresh",
		url: "/api/ai-insights/refresh",
		min: "write",
		body: { site_id: SITE, range: "7d" },
	},
	{
		method: "POST",
		pattern: "/api/appstoreconnect/sync",
		url: "/api/appstoreconnect/sync",
		min: "write",
		body: { site_id: SITE },
	},
	{
		method: "POST",
		pattern: "/api/gsc/sync",
		url: `/api/gsc/sync?site_id=${SITE}`,
		min: "write",
	},
	{
		method: "POST",
		pattern: "/api/gsc/service-account",
		url: "/api/gsc/service-account",
		min: "manage",
		body: { site_id: SITE, key: "not-a-key" },
	},
	{
		method: "POST",
		pattern: "/api/gsc/auth-url",
		url: "/api/gsc/auth-url",
		min: "manage",
		body: { site_id: SITE },
	},
	{
		method: "POST",
		pattern: "/api/import/onedollarstats",
		url: "/api/import/onedollarstats",
		min: "manage",
		body: { site_id: SITE, api_key: "k", ods_site_id: "o" },
	},
	{
		method: "POST",
		pattern: "/api/payment-providers",
		url: "/api/payment-providers",
		min: "write",
		body: { site_id: SITE, provider: "midtrans", config: { webhook_secret: "s" } },
	},
	{
		method: "DELETE",
		pattern: "/api/payment-providers/:provider",
		url: `/api/payment-providers/xendit?site_id=${SITE}`,
		min: "write",
		seed: seedProvider,
	},
	{
		method: "PUT",
		pattern: "/api/polar/config",
		url: "/api/polar/config",
		min: "write",
		body: { site_id: SITE, webhook_secret: "polar_whs_x" },
	},
	{
		method: "POST",
		pattern: "/api/polar/sync",
		url: "/api/polar/sync",
		min: "write",
		body: { site_id: SITE },
	},
	{ method: "DELETE", pattern: "/api/polar", url: `/api/polar?site_id=${SITE}`, min: "write" },
	{
		method: "POST",
		pattern: "/api/integrations",
		url: "/api/integrations",
		min: "owner",
		body: { site_id: SITE, type: "mailchimp", name: "hook", config: { api_key: "k-us1" } },
	},
	{
		method: "PATCH",
		pattern: "/api/integrations/:id",
		url: "/api/integrations/in-1",
		min: "owner",
		body: { name: "renamed" },
		seed: seedIntegration,
	},
	{
		method: "DELETE",
		pattern: "/api/integrations/:id",
		url: "/api/integrations/in-1",
		min: "owner",
		seed: seedIntegration,
	},
	{
		method: "POST",
		pattern: "/api/integrations/:id/test",
		url: "/api/integrations/in-1/test",
		min: "owner",
		seed: seedIntegration,
	},
	{
		method: "POST",
		pattern: "/api/share/:siteId/toggle",
		url: `/api/share/${SITE}/toggle`,
		min: "owner",
	},
	{
		method: "POST",
		pattern: "/api/sites/:siteId/exclusions",
		url: `/api/sites/${SITE}/exclusions`,
		min: "owner",
		body: { fingerprint: "abc123abc123abc1", label: "me" },
	},
	{
		method: "DELETE",
		pattern: "/api/sites/:siteId/exclusions/:fp",
		url: `/api/sites/${SITE}/exclusions/abc123abc123abc1`,
		min: "owner",
	},
	{
		method: "POST",
		pattern: "/api/sites/:siteId/widget/toggle",
		url: `/api/sites/${SITE}/widget/toggle`,
		min: "owner",
	},
	{
		method: "POST",
		pattern: "/api/sites/:siteId/widget/regenerate",
		url: `/api/sites/${SITE}/widget/regenerate`,
		min: "owner",
	},
	{
		method: "PATCH",
		pattern: "/api/sites/:siteId/widget/config",
		url: `/api/sites/${SITE}/widget/config`,
		min: "owner",
		body: {},
	},
	{
		method: "PATCH",
		pattern: "/api/sites/:siteId",
		url: `/api/sites/${SITE}`,
		min: "owner",
		body: { revenue_currency: "IDR" },
	},
	{
		method: "POST",
		pattern: "/api/team/invite",
		url: "/api/team/invite",
		min: "owner",
		body: { site_id: SITE, email: "nobody@example.com", role: "viewer" },
	},
	{
		method: "PATCH",
		pattern: "/api/team/:memberId",
		url: "/api/team/tm-spare",
		min: "owner",
		body: { role: "editor" },
		seed: seedMember,
	},
	{
		method: "DELETE",
		pattern: "/api/team/:memberId",
		url: "/api/team/tm-spare",
		min: "owner",
		seed: seedMember,
	},
	{
		method: "POST",
		pattern: "/api/sites/:siteId/purge",
		url: `/api/sites/${SITE}/purge`,
		min: "owner",
		body: { confirm: true },
	},
	{
		method: "DELETE",
		pattern: "/api/sites/:siteId",
		url: `/api/sites/${SITE}`,
		min: "owner",
		destructive: true,
	},
];

/** Routes that only ever act on the signed-in user's own data (no site id involved). */
const OWN_DATA_ROUTES = [
	"DELETE /api/auth/account",
	"DELETE /api/auth/links/:id",
	"DELETE /api/push/devices",
	"DELETE /api/tokens/:id",
	"POST /api/affiliates/generate-code",
	"POST /api/auth/links",
	"POST /api/auth/links/google-intent",
	"POST /api/auth/links/google/complete",
	"POST /api/auth/links/google/preview",
	"POST /api/auth/logout",
	"POST /api/auth/switch",
	"POST /api/billing/alerts",
	"POST /api/billing/cancel",
	"POST /api/billing/checkout",
	"POST /api/billing/checkout/pakasir",
	"POST /api/billing/pakasir/verify",
	"POST /api/billing/test-email",
	"POST /api/oauth/authorize",
	"POST /api/push/devices",
	"POST /api/push/test",
	"POST /api/sites",
	"POST /api/team/invitations/:id/accept",
	"POST /api/team/invitations/:id/decline",
	"POST /api/tokens",
	"PUT /api/fee-rules",
	"PUT /api/push/prefs",
];

/** super_admin only. */
const ADMIN_ROUTES = ["PATCH /api/admin/users/:id", "POST /api/admin/backup"];

/** Authenticated by an API token (rv_/rvt_) with its own scope and site binding. */
const API_TOKEN_ROUTES = [
	"DELETE /api/v1/tokens/:id",
	"POST /api/mcp",
	"DELETE /api/mcp",
	"POST /api/track/payment",
	"POST /api/v1/events/server",
	"POST /api/v1/tokens",
];

/** Unauthenticated by design: the credential is a signature, a one-time token or the public site id. */
const PUBLIC_ROUTES = [
	"POST /api/auth/forgot-password",
	"POST /api/auth/login",
	"POST /api/auth/register",
	"POST /api/auth/resend-verification",
	"POST /api/auth/reset-password",
	"POST /api/auth/verify-email",
	"POST /api/billing/webhook",
	"POST /api/identify",
	"POST /api/track",
	"POST /api/track/heatmap",
	"POST /api/track/recording",
	"POST /api/webhooks/beehiiv",
	"POST /api/webhooks/convertkit",
	"POST /api/webhooks/doku",
	"POST /api/webhooks/kit",
	"POST /api/webhooks/lemonsqueezy",
	"POST /api/webhooks/mailchimp",
	"POST /api/webhooks/mayar",
	"POST /api/webhooks/midtrans",
	"POST /api/webhooks/pakasir",
	"POST /api/webhooks/paywuz",
	"POST /api/webhooks/polar",
	"POST /api/webhooks/stripe",
	"POST /api/webhooks/xendit",
	// Books' server redeems a code with its client secret and PKCE verifier; no session involved.
	"POST /oauth/token",
];

/** Unfinished, 404 unless MARKETPLACES_ENABLED. */
const GATED_ROUTES = ["POST /api/marketplace/shopee/sync", "POST /api/marketplace/tokopedia/sync"];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function mountedMutatingRoutes(): string[] {
	const seen = new Set<string>();
	for (const r of createApp().routes) {
		if (MUTATING.has(r.method)) seen.add(`${r.method} ${r.path}`);
	}
	return [...seen].sort();
}

describe("route census", () => {
	it("classifies every mutating route", () => {
		const classified = new Set<string>([
			...SITE_ROUTES.map((r) => `${r.method} ${r.pattern}`),
			...OWN_DATA_ROUTES,
			...ADMIN_ROUTES,
			...API_TOKEN_ROUTES,
			...PUBLIC_ROUTES,
			...GATED_ROUTES,
		]);
		const unclassified = mountedMutatingRoutes().filter((r) => !classified.has(r));
		// A new route lands here until it is added to the right list above. Site routes need an
		// entry in SITE_ROUTES so the role matrix exercises them.
		expect(unclassified).toEqual([]);
	});

	it("lists no route that is not mounted", () => {
		const mounted = new Set(mountedMutatingRoutes());
		const stale = [
			...SITE_ROUTES.map((r) => `${r.method} ${r.pattern}`),
			...OWN_DATA_ROUTES,
			...ADMIN_ROUTES,
			...API_TOKEN_ROUTES,
			...PUBLIC_ROUTES,
			...GATED_ROUTES,
		].filter((r) => !mounted.has(r));
		expect(stale).toEqual([]);
	});

	it("keeps viewers read-only in the role table", () => {
		const viewerCan = Object.entries(ROLE_TABLE.viewer)
			.filter(([, allowed]) => allowed)
			.map(([action]) => action);
		expect(viewerCan).toEqual(["read"]);
		expect(ROLE_TABLE.editor.manage).toBe(false);
		expect(ROLE_TABLE.admin.owner).toBe(false);
	});
});

describe("role matrix: every site route as every caller", () => {
	const realFetch = globalThis.fetch;
	let t: MigratedTestApp;
	const tokens = {} as Record<Caller, string>;

	beforeAll(async () => {
		// Allowed callers reach handlers that call out (GSC, importer, webhooks): never the network.
		globalThis.fetch = offlineFetch;
		t = await createMigratedTestApp();
		tokens.owner = await t.seedUser({ id: "u-owner", withSite: SITE, plan: "growth" });
		for (const caller of ["stranger", "pending", "viewer", "editor", "admin"] as const) {
			tokens[caller] = await t.seedUser({ id: `u-${caller}`, plan: "growth" });
		}
		for (const role of ["viewer", "editor", "admin"] as const) {
			t.db
				.prepare(
					"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES (?,?,?,?,'u-owner',?,?)",
				)
				.run(`tm-${role}`, SITE, `u-${role}`, role, now, now);
		}
		// An invitation nobody accepted yet grants nothing, whatever its role.
		t.db
			.prepare(
				"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES ('tm-pending', ?, 'u-pending', 'admin', 'u-owner', ?, NULL)",
			)
			.run(SITE, now);
	});

	afterAll(() => {
		globalThis.fetch = realFetch;
	});

	const mounted = new Set(mountedMutatingRoutes());
	const routes = SITE_ROUTES.filter((r) => mounted.has(`${r.method} ${r.pattern}`));
	const ordered = [...routes.filter((r) => !r.destructive), ...routes.filter((r) => r.destructive)];

	const allowed = (caller: Caller, route: SiteRoute): boolean => {
		if (caller === "stranger" || caller === "pending") return false;
		return ROLE_TABLE[caller][route.min];
	};

	for (const route of ordered) {
		describe(`${route.method} ${route.pattern}`, () => {
			for (const caller of CALLERS) {
				const mayDo = allowed(caller, route);
				it(`${caller} is ${mayDo ? "let through" : "refused"}`, async () => {
					route.seed?.(t.db);
					const res = await t.call(route.method, route.url, {
						token: tokens[caller],
						...(route.body !== undefined ? { body: route.body } : {}),
					});
					const text = await res.text();
					if (mayDo) {
						// Past the access check: whatever the handler says next, it is not an access refusal.
						expect(res.status, text).not.toBe(401);
						expect(res.status, text).not.toBe(403);
						expect(text).not.toMatch(/role on this site|Site not found|Only owner/i);
					} else {
						expect([403, 404], text).toContain(res.status);
						expect(text).toMatch(/role on this site|not found|Only owner/i);
					}
				});
			}
		});
	}

	it("a refused write changes nothing; an editor's visitor note lands on that site's profile", async () => {
		const fresh = await createMigratedTestApp();
		await fresh.seedUser({ id: "u-owner", withSite: SITE, plan: "growth" });
		const viewer = await fresh.seedUser({ id: "u-viewer", plan: "growth" });
		const editor = await fresh.seedUser({ id: "u-editor", plan: "growth" });
		for (const [id, user, role] of [
			["tm-v", "u-viewer", "viewer"],
			["tm-e", "u-editor", "editor"],
		] as const) {
			fresh.db
				.prepare(
					"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES (?,?,?,?,'u-owner',?,?)",
				)
				.run(id, SITE, user, role, now, now);
		}
		// Same visitor id on another site: the note must never reach it.
		seedVisitor(fresh.db);
		fresh.db
			.prepare(
				"INSERT INTO visitor_profiles (id, site_id, visitor_id) VALUES ('vp-other', 's-other', 'vid-1')",
			)
			.run();
		const notes = () => fresh.db.query("SELECT id, notes FROM visitor_profiles ORDER BY id").all();

		const refused = await fresh.call("PATCH", "/api/analytics/visitors/vp-1", {
			token: viewer,
			body: { notes: "viewer was here" },
		});
		expect(refused.status).toBe(403);
		expect(notes()).toEqual([
			{ id: "vp-1", notes: null },
			{ id: "vp-other", notes: null },
		]);

		const saved = await fresh.call("PATCH", "/api/analytics/visitors/vp-1", {
			token: editor,
			body: { notes: "vip", tags: "a,b" },
		});
		expect(saved.status).toBe(200);
		expect(notes()).toEqual([
			{ id: "vp-1", notes: "vip" },
			{ id: "vp-other", notes: null },
		]);

		const annotation = await fresh.call("POST", "/api/annotations", {
			token: viewer,
			body: { site_id: SITE, date: "2026-01-02", text: "nope" },
		});
		expect(annotation.status).toBe(403);
		expect(fresh.db.query("SELECT COUNT(*) AS n FROM annotations").get()).toEqual({ n: 0 });
	});
});

describe("read routes: a stranger sees nothing, a viewer reads", () => {
	let t: MigratedTestApp;
	const tokens = {} as Record<"owner" | "viewer" | "stranger", string>;

	beforeAll(async () => {
		t = await createMigratedTestApp();
		tokens.owner = await t.seedUser({ id: "u-owner", withSite: SITE, plan: "growth" });
		tokens.viewer = await t.seedUser({ id: "u-viewer", plan: "growth" });
		tokens.stranger = await t.seedUser({ id: "u-stranger", plan: "growth" });
		t.db
			.prepare(
				"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES ('tm-v', ?, 'u-viewer', 'viewer', 'u-owner', ?, ?)",
			)
			.run(SITE, now, now);
		seedAnnotation(t.db);
		seedSegment(t.db);
		seedReport(t.db);
		seedVisitor(t.db);
		t.db
			.prepare(
				"INSERT INTO session_recordings (id, site_id, session_id, visitor_id, path, events) VALUES ('rec-1', ?, 'sid-1', 'vid-1', '/', '[]')",
			)
			.run(SITE);
	});

	const READS: { url: string; viewerAllowed: boolean }[] = [
		{ url: `/api/annotations?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/segments?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/email-reports?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/appstoreconnect/metrics?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/appstoreconnect/prices?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/gsc/queries?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/payment-providers?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/polar/status?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/ai-insights?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/analytics/dashboard?site_id=${SITE}`, viewerAllowed: true },
		{ url: `/api/analytics/visitors?site_id=${SITE}`, viewerAllowed: true },
		{ url: "/api/analytics/recordings/rec-1", viewerAllowed: true },
		{ url: `/api/sites/${SITE}/access`, viewerAllowed: true },
		// Owner-only today: integrations hold credentials, team and sharing are owner decisions.
		{ url: `/api/integrations?site_id=${SITE}`, viewerAllowed: false },
		{ url: `/api/team?site_id=${SITE}`, viewerAllowed: false },
		{ url: `/api/share/${SITE}/status`, viewerAllowed: false },
		{ url: `/api/sites/${SITE}/snippet`, viewerAllowed: false },
	];

	for (const { url, viewerAllowed } of READS) {
		it(`GET ${url.split("?")[0]}`, async () => {
			const stranger = await t.call("GET", url, { token: tokens.stranger });
			expect([403, 404], await stranger.clone().text()).toContain(stranger.status);
			const viewer = await t.call("GET", url, { token: tokens.viewer });
			if (viewerAllowed) {
				expect(viewer.status, await viewer.clone().text()).not.toBe(403);
				expect(viewer.status).not.toBe(404);
			} else {
				expect([403, 404]).toContain(viewer.status);
			}
			const owner = await t.call("GET", url, { token: tokens.owner });
			expect(owner.status, await owner.clone().text()).toBeLessThan(500);
			expect([403, 401]).not.toContain(owner.status);
		});
	}

	it("tells each caller their own role", async () => {
		const as = async (who: keyof typeof tokens) => {
			const res = await t.call("GET", `/api/sites/${SITE}/access`, { token: tokens[who] });
			const body: { data: { role: string; can: Record<string, boolean> } } = await res.json();
			return body.data;
		};
		expect((await as("owner")).role).toBe("owner");
		const viewer = await as("viewer");
		expect(viewer.role).toBe("viewer");
		expect(viewer.can).toEqual({ read: true, write: false, manage: false, owner: false });
	});
});

describe("every authenticated route refuses a request with no token", () => {
	it("answers 401 unless it is public by design", async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = offlineFetch;
		try {
			const t = await createMigratedTestApp();
			const publicByDesign = new Set([
				...PUBLIC_ROUTES,
				...GATED_ROUTES,
				// Token routes answer 401 as well, but their handlers need a body first.
				"POST /api/track/payment",
			]);
			const publicGets = [
				/^GET \/api$/,
				/^GET \/api\/health$/,
				/^GET \/api\/docs/,
				/^GET \/api\/klikapa\.js$/,
				/^GET \/api\/auth\/google/,
				/^GET \/api\/gsc\/callback$/,
				/^GET \/api\/public\//,
				/^GET \/api\/widgets\/live\//,
				/^GET \/api\/widget-data$/,
				/^GET \/api\/marketplace\//,
				/^GET \/api\/billing\/plans$/,
				// Validates the SSO request, then hands over to a page that signs in with the dashboard token.
				/^GET \/oauth\/authorize$/,
				// MCP GET describes the endpoint and DELETE is a fixed 405; tool calls (POST) need a token.
				/^GET \/api\/mcp$/,
				/^DELETE \/api\/mcp$/,
			];
			const failures: string[] = [];
			const seen = new Set<string>();
			for (const r of createApp().routes) {
				if (r.method === "ALL" || r.method === "OPTIONS" || r.method === "HEAD") continue;
				const key = `${r.method} ${r.path}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (publicByDesign.has(key) || publicGets.some((p) => p.test(key))) continue;
				const url = r.path.replace(/:[A-Za-z]+/g, "x");
				const res = await t.call(r.method, url, r.method === "GET" ? {} : { body: {} });
				if (res.status !== 401) failures.push(`${key} -> ${res.status}`);
			}
			expect(failures).toEqual([]);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("keeps Shopee and Tokopedia off unless the operator opts in", async () => {
		const t = await createMigratedTestApp();
		const owner = await t.seedUser({ id: "u-mk", withSite: "s-mk", plan: "growth" });
		for (const url of [
			"/api/marketplace/shopee/auth?site_id=s-mk",
			"/api/marketplace/shopee/callback?code=x&state=y",
			"/api/marketplace/tokopedia/auth?site_id=s-mk",
			"/api/marketplace/shopee/orders?site_id=s-mk",
		]) {
			expect((await t.call("GET", url, { token: owner })).status).toBe(404);
		}
		for (const url of ["/api/marketplace/shopee/sync", "/api/marketplace/tokopedia/sync"]) {
			expect((await t.call("POST", url, { token: owner, body: { site_id: "s-mk" } })).status).toBe(
				404,
			);
		}
	});
});

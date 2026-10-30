import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { generateId, hashToken } from "../utils";

/**
 * One fixture site, read through every surface that reports its numbers. The
 * definitions live in lib/metrics.ts; this pins that every surface uses them.
 *
 * Fixture (all within the last 6 days, USD):
 *   A  pageview /, pageview /pricing, a heartbeat      (session s-a)
 *   B  pageview /, a 100 sale                          (session s-b)
 *   C  a click and nothing else - not a visitor        (session s-c)
 *   D  a 50 server-reported payment, no pageview       (no session)
 *   -  a -20 refund, a zero-revenue goal, a test sale (excluded), a bot pageview
 */
const SITE = "s-parity";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

let seq = 0;
function addEvent(
	t: MigratedTestApp,
	e: {
		visitor: string;
		session: string;
		type: string;
		hoursAgo: number;
		path?: string;
		revenue?: number | null;
		externalId?: string | null;
		excluded?: string | null;
		bot?: number;
		referrer?: string | null;
	},
) {
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, revenue, currency, external_id, excluded_reason, is_bot, referrer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			`e${++seq}`,
			SITE,
			e.session,
			e.visitor,
			hoursAgo(e.hoursAgo),
			e.type,
			e.path ?? "/",
			e.revenue ?? null,
			e.revenue ? "USD" : null,
			e.externalId ?? null,
			e.excluded ?? null,
			e.bot ?? 0,
			e.referrer ?? null,
		);
}

function addSession(t: MigratedTestApp, id: string, visitor: string, startedHoursAgo: number) {
	t.db
		.prepare(
			"INSERT INTO sessions (id, site_id, visitor_id, started_at, entry_path, exit_path, page_count, is_bounce) VALUES (?,?,?,?,?,?,1,1)",
		)
		.run(id, SITE, visitor, hoursAgo(startedHoursAgo), "/", "/");
}

async function addToken(t: MigratedTestApp, userId: string) {
	const token = `rvt_${generateId().replaceAll("-", "")}`;
	t.db
		.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run(
			generateId(),
			userId,
			await hashToken(token),
			token.slice(0, 8),
			"t",
			"account",
			JSON.stringify(["analytics:read", "sites:read"]),
			null,
		);
	return token;
}

async function fixture(plan = "growth") {
	const t = await createMigratedTestApp();
	const session = await t.seedUser({ id: `u-parity-${plan}`, plan, withSite: SITE });
	const apiToken = await addToken(t, `u-parity-${plan}`);

	addSession(t, "s-a", "A", 30);
	addSession(t, "s-b", "B", 20);
	addSession(t, "s-c", "C", 10);

	addEvent(t, { visitor: "A", session: "s-a", type: "pageview", hoursAgo: 30, path: "/" });
	addEvent(t, {
		visitor: "A",
		session: "s-a",
		type: "pageview",
		hoursAgo: 29,
		path: "/pricing",
		referrer: "https://www.google.com/",
	});
	addEvent(t, { visitor: "A", session: "s-a", type: "custom", hoursAgo: 28 });
	addEvent(t, { visitor: "B", session: "s-b", type: "pageview", hoursAgo: 20 });
	addEvent(t, { visitor: "B", session: "s-b", type: "conversion", hoursAgo: 19, revenue: 100 });
	addEvent(t, { visitor: "C", session: "s-c", type: "custom", hoursAgo: 10 });
	addEvent(t, {
		visitor: "D",
		session: "ord1",
		type: "payment",
		hoursAgo: 9,
		revenue: 50,
		externalId: "ord1",
	});
	addEvent(t, {
		visitor: "D",
		session: "ord1",
		type: "refund",
		hoursAgo: 8,
		revenue: -20,
		externalId: "ord1:refund",
	});
	addEvent(t, { visitor: "B", session: "s-b", type: "conversion", hoursAgo: 7 });
	addEvent(t, {
		visitor: "B",
		session: "s-b",
		type: "conversion",
		hoursAgo: 6,
		revenue: 999,
		excluded: "test",
	});
	addEvent(t, { visitor: "BOT", session: "s-bot", type: "pageview", hoursAgo: 5, bot: 1 });
	return { t, session, apiToken };
}

interface Stats {
	pageviews: number;
	visitors: number;
	sessions: number;
	conversions: number;
	revenue: number;
	netRevenue?: number;
	netEstimated?: boolean;
}

interface Change {
	current: number;
	previous: number;
	changePct: number | null;
}

interface Dashboard {
	stats: Stats;
	compare: Record<string, Change>;
	timeseries: { pageviews: number }[];
	prev_timeseries: { pageviews: number }[];
	topPages: { pageviews: number }[];
	channels: { pageviews: number; visitors: number; percentage: number }[];
	revenueBySource: { conversions: number }[];
	revenueTimeseries: { revenue: number }[];
}

interface Portfolio {
	totals: { gross: number; sales: number };
}

async function data<T>(res: Response): Promise<T> {
	const body: { data: T } = await res.json();
	return body.data;
}

async function dashboardOf(t: MigratedTestApp, session: string): Promise<Dashboard> {
	return data<Dashboard>(
		await t.call("GET", `/api/analytics/dashboard?site_id=${SITE}&range=7d`, { token: session }),
	);
}

async function surfaces(t: MigratedTestApp, session: string, apiToken: string) {
	const dash = await dashboardOf(t, session);
	const siteRows = await data<
		{ id: string; pageviews: number; visitors: number; revenue: number }[]
	>(await t.call("GET", "/api/sites?range=7d", { token: session }));
	const sites = siteRows.find((s) => s.id === SITE);
	if (!sites) throw new Error("fixture site missing from /api/sites");
	const v1 = await data<Stats>(
		await t.call("GET", `/api/v1/analytics/overview?site_id=${SITE}&range=7d`, { token: apiToken }),
	);
	const rpc: { result: { content: { text: string }[] } } = await (
		await t.call("POST", "/api/mcp", {
			token: apiToken,
			body: {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "analytics_overview", arguments: { site_id: SITE, range: "7d" } },
			},
		})
	).json();
	const mcp: Stats = JSON.parse(rpc.result.content[0]?.text ?? "{}");
	const day = (d: Date) => d.toISOString().slice(0, 10);
	const portfolio = await data<Portfolio>(
		await t.call(
			"GET",
			`/api/portfolio/revenue?from=${day(new Date(Date.now() - 8 * 86_400_000))}&to=${day(new Date(Date.now() + 86_400_000))}&currency=USD`,
			{ token: session },
		),
	);
	return { dash, sites, v1, mcp, portfolio };
}

describe("one definition per metric across surfaces", () => {
	it("dashboard, sites overview, v1 API, MCP and portfolio agree on the fixture", async () => {
		const { t, session, apiToken } = await fixture();
		const { dash, sites, v1, mcp, portfolio } = await surfaces(t, session, apiToken);

		// Pageviews: A twice, B once. Not the bot, not the custom/server events.
		// Visitors: A and B only: C's click, D's payment and the bot are not visitors.
		for (const s of [dash.stats, v1, mcp]) {
			expect(s.pageviews).toBe(3);
			expect(s.visitors).toBe(2);
			expect(s.sessions).toBe(3);
			// Conversions: the 100 sale, the 50 payment and the zero-revenue goal.
			// The refund is not one and the test sale is excluded.
			expect(s.conversions).toBe(3);
			// Revenue: 100 + 50 - 20, test sale excluded.
			expect(s.revenue).toBe(130);
		}
		expect(sites.pageviews).toBe(3);
		expect(sites.visitors).toBe(2);
		expect(sites.revenue).toBeCloseTo(130);

		// Net revenue follows the same window and fee rules everywhere.
		expect(v1.netRevenue).toBeCloseTo(dash.stats.netRevenue ?? Number.NaN);
		expect(mcp.netRevenue).toBeCloseTo(dash.stats.netRevenue ?? Number.NaN);
		expect(v1.netEstimated).toBe(dash.stats.netEstimated);

		// Portfolio counts sales (revenue > 0), not goal events.
		expect(portfolio.totals.gross).toBeCloseTo(130);
		expect(portfolio.totals.sales).toBe(2);
		const salesInPanels = dash.revenueBySource.reduce((s, r) => s + r.conversions, 0);
		expect(salesInPanels).toBe(portfolio.totals.sales);
	});

	it("breakdown panels add up to the headline figures", async () => {
		const { t, session, apiToken } = await fixture();
		const { dash } = await surfaces(t, session, apiToken);
		const sum = (rows: { pageviews?: number; visitors?: number }[], k: "pageviews" | "visitors") =>
			rows.reduce((s, r) => s + (r[k] ?? 0), 0);

		// Channel pageviews count pageviews, not every event (A's heartbeat, C's click).
		expect(sum(dash.channels, "pageviews")).toBe(dash.stats.pageviews);
		// Shares are of the headline visitor count.
		for (const c of dash.channels) {
			expect(c.percentage).toBe(Math.round((c.visitors / dash.stats.visitors) * 100));
		}
		expect(sum(dash.topPages, "pageviews")).toBe(dash.stats.pageviews);
		expect(sum(dash.timeseries, "pageviews")).toBe(dash.stats.pageviews);
		expect(dash.revenueTimeseries.reduce((s, r) => s + r.revenue, 0)).toBe(dash.stats.revenue);

		const geo = await data<{ visitors: number }[]>(
			await t.call("GET", `/api/analytics/geo?site_id=${SITE}&range=7d`, { token: session }),
		);
		expect(geo.reduce((s, r) => s + r.visitors, 0)).toBeLessThanOrEqual(dash.stats.visitors);
	});

	it("a visitor never outnumbers pageviews even when only non-pageview events exist", async () => {
		const t = await createMigratedTestApp();
		const session = await t.seedUser({ id: "u-parity-empty", plan: "growth", withSite: SITE });
		for (let i = 0; i < 5; i++) {
			addEvent(t, { visitor: `heart-${i}`, session: `h${i}`, type: "custom", hoursAgo: 2 });
		}
		const dash = await dashboardOf(t, session);
		expect(dash.stats.visitors).toBe(0);
		expect(dash.stats.pageviews).toBe(0);
	});
});

describe("comparison period", () => {
	it("renders deltas on the default range of the shortest-retention plan", async () => {
		// Micro keeps 7 days of history: the 7d view used to clamp the previous
		// window to a zero-width slice and every delta collapsed to "no data".
		const { t, session } = await fixture("micro");
		addEvent(t, { visitor: "OLD", session: "s-old", type: "pageview", hoursAgo: 9 * 24 });
		addEvent(t, { visitor: "OLD2", session: "s-old2", type: "pageview", hoursAgo: 10 * 24 });
		addEvent(t, {
			visitor: "OLD2",
			session: "s-old2",
			type: "conversion",
			hoursAgo: 10 * 24,
			revenue: 40,
		});

		const dash = await dashboardOf(t, session);
		expect(dash.compare.visitors).toEqual({ current: 2, previous: 2, changePct: 0 });
		expect(dash.compare.pageviews?.previous).toBe(2);
		expect(dash.compare.revenue).toEqual({ current: 130, previous: 40, changePct: 225 });
		expect(dash.compare.conversions?.previous).toBe(1);
		expect(dash.prev_timeseries.some((p) => p.pageviews > 0)).toBe(true);
	});
});

/**
 * MCP tool handlers. Thin adapters over lib/public-api-queries — the same
 * functions the v1 REST routes use, so the two surfaces cannot drift.
 */
import {
	EXPORT_COLUMNS,
	PublicApiError,
	type PublicApiCtx,
	eventsRowsForCsv,
	eventsRowsToJson,
	exportRows,
	queryCampaigns,
	queryDevices,
	queryGeo,
	queryGscQueries,
	queryJourneys,
	queryOverview,
	queryReferrers,
	queryRevenue,
	querySites,
	queryTimeseries,
	queryTopPages,
	queryWhoami,
	requireScopeOn,
	toCsv,
} from "../../lib/public-api-queries";
import { getToolDef, type ToolName } from "./tools";

export type ToolCallOutcome =
	| { ok: true; data: unknown }
	| { ok: false; error: string; hint?: string; code?: -32602 };

/** args.site_id missing → default to the rv_ token's bound site. */
export function resolveSiteId(
	ctx: { tokenSiteId: string | null },
	siteId: unknown,
): string | undefined {
	if (typeof siteId === "string" && siteId) return siteId;
	return ctx.tokenSiteId ?? undefined;
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
	const v = args[key];
	return typeof v === "string" && v ? v : undefined;
}

function intArg(args: Record<string, unknown>, key: string, def: number, max: number): number {
	const n = Number(args[key]);
	if (!Number.isFinite(n) || n < 1) return def;
	return Math.min(Math.floor(n), max);
}

type ToolHandler = (ctx: PublicApiCtx, args: Record<string, unknown>) => Promise<unknown>;

export const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
	whoami: (ctx) => queryWhoami(ctx),
	list_sites: (ctx) => querySites(ctx),
	analytics_overview: async (ctx, a) =>
		queryOverview(ctx, resolveSiteId(ctx, a.site_id), strArg(a, "range") ?? "7d"),
	analytics_timeseries: async (ctx, a) =>
		queryTimeseries(ctx, resolveSiteId(ctx, a.site_id), strArg(a, "range") ?? "7d"),
	top_pages: async (ctx, a) =>
		queryTopPages(
			ctx,
			resolveSiteId(ctx, a.site_id),
			strArg(a, "range") ?? "7d",
			intArg(a, "limit", 10, 100),
		),
	top_referrers: async (ctx, a) =>
		queryReferrers(
			ctx,
			resolveSiteId(ctx, a.site_id),
			strArg(a, "range") ?? "7d",
			intArg(a, "limit", 10, 100),
		),
	geo_breakdown: async (ctx, a) =>
		queryGeo(
			ctx,
			resolveSiteId(ctx, a.site_id),
			strArg(a, "range") ?? "7d",
			intArg(a, "limit", 50, 100),
		),
	device_breakdown: async (ctx, a) =>
		queryDevices(ctx, resolveSiteId(ctx, a.site_id), strArg(a, "range") ?? "7d"),
	revenue_breakdown: async (ctx, a) =>
		queryRevenue(ctx, resolveSiteId(ctx, a.site_id), strArg(a, "range") ?? "7d"),
	campaigns: async (ctx, a) =>
		queryCampaigns(ctx, resolveSiteId(ctx, a.site_id), strArg(a, "range") ?? "7d"),
	visitor_journeys: async (ctx, a) =>
		queryJourneys(
			ctx,
			resolveSiteId(ctx, a.site_id),
			strArg(a, "range") ?? "7d",
			intArg(a, "limit", 20, 100),
			strArg(a, "path"),
		),
	gsc_queries: async (ctx, a) =>
		queryGscQueries(ctx, resolveSiteId(ctx, a.site_id), intArg(a, "limit", 20, 100)),
	export_events: async (ctx, a) => {
		const siteId = resolveSiteId(ctx, a.site_id);
		const range = strArg(a, "range") ?? "30d";
		const type = (strArg(a, "type") ?? "events") as "events" | "visitors" | "sessions";
		const format = strArg(a, "format") ?? "json";

		const rows = await exportRows(ctx, siteId, range, {
			type,
			eventType: strArg(a, "event_type"),
			limit: intArg(a, "limit", 500, 1000),
		});

		if (format === "csv") {
			const csvRows =
				type === "events"
					? eventsRowsForCsv(rows as { props: string | null; [k: string]: unknown }[])
					: rows;
			const csv = toCsv(csvRows, [...EXPORT_COLUMNS[type]]);
			return `# csv export: ${type}-${siteId}-${range}.csv\n${csv}`;
		}

		const data =
			type === "events"
				? eventsRowsToJson(rows as { props: string | null; [k: string]: unknown }[])
				: rows;
		return { format, type, site_id: siteId, range, count: data.length, data };
	},
};

/** Dispatch a tools/call: scope check → handler → outcome. */
export async function callTool(
	ctx: PublicApiCtx,
	name: string,
	args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
	const def = getToolDef(name);
	if (!def) {
		return { ok: false, error: `Unknown tool: ${name}`, code: -32602 };
	}
	try {
		if (def.scope) requireScopeOn(ctx, def.scope);
		return { ok: true, data: await TOOL_HANDLERS[def.name](ctx, args) };
	} catch (e) {
		if (e instanceof PublicApiError) {
			return { ok: false, error: e.message, hint: hintFor(e) };
		}
		throw e;
	}
}

function hintFor(e: PublicApiError): string | undefined {
	if (e.hint) return e.hint;
	if (e.status === 403) {
		return "Run whoami to inspect this token's scopes and bound site.";
	}
	if (e.status === 404) {
		return "Run list_sites to see accessible site ids.";
	}
	return undefined;
}

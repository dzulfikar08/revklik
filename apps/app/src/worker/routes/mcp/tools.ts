/**
 * MCP tool registry — pure data, zero worker imports (so the drift-guard
 * test pulls in nothing heavy). Mirrors the v1 REST API 1:1.
 * Convention (opexmx precedent): snake_case names, description embeds the
 * backing route, single pretty-JSON text block per result.
 */

export const CANONICAL_TOOL_NAMES = [
	"whoami",
	"list_sites",
	"analytics_overview",
	"analytics_timeseries",
	"top_pages",
	"top_referrers",
	"geo_breakdown",
	"device_breakdown",
	"revenue_breakdown",
	"campaigns",
	"visitor_journeys",
	"export_events",
] as const;

export type ToolName = (typeof CANONICAL_TOOL_NAMES)[number];

export type ToolScope = "sites:read" | "analytics:read" | "analytics:export";

export interface ToolDef {
	name: ToolName;
	description: string;
	scope?: ToolScope;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

const rangeProperty = {
	type: "string",
	default: "7d",
	enum: ["7d", "30d", "90d", "24h"],
	description: 'Time range: 7d/30d/90d/24h, or "YYYY-MM-DD,YYYY-MM-DD"',
} as const;

const siteIdProperty = {
	type: "string",
	description:
		"Site id (get ids from list_sites). Optional for rv_ site tokens — defaults to the bound site.",
} as const;

const limitProperty = (def: number) => ({
	type: "integer",
	default: def,
	maximum: 100,
	description: `Max rows to return (default ${def}, max 100)`,
});

const siteArgs = (extra: Record<string, unknown> = {}, required = ["site_id", "range"]) => ({
	type: "object" as const,
	properties: { site_id: siteIdProperty, range: rangeProperty, ...extra },
	required,
});

export const TOOL_DEFS: ToolDef[] = [
	{
		name: "whoami",
		description:
			"Identify the current API token: user, plan, token type, scopes, bound site. REST: GET /api/v1/whoami",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "list_sites",
		description:
			"List sites accessible to this token (owned + team). Needs sites:read — account tokens (rvt_) only. REST: GET /api/v1/sites",
		scope: "sites:read",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "analytics_overview",
		description:
			"Core metrics for a site and range: pageviews, visitors, sessions, bounce rate, revenue, conversions. REST: GET /api/v1/analytics/overview",
		scope: "analytics:read",
		inputSchema: siteArgs(),
	},
	{
		name: "analytics_timeseries",
		description:
			"Pageviews and visitors per day (hourly for ranges up to 48h). REST: GET /api/v1/analytics/timeseries",
		scope: "analytics:read",
		inputSchema: siteArgs(),
	},
	{
		name: "top_pages",
		description: "Top pages by pageviews for a site and range. REST: GET /api/v1/analytics/pages",
		scope: "analytics:read",
		inputSchema: siteArgs({ limit: limitProperty(10) }),
	},
	{
		name: "top_referrers",
		description:
			"Top traffic sources (utm_source or referrer hostname, 'direct' if none) with visitor share. REST: GET /api/v1/analytics/referrers",
		scope: "analytics:read",
		inputSchema: siteArgs({ limit: limitProperty(10) }),
	},
	{
		name: "geo_breakdown",
		description:
			"Visitors by country/region/city for a site and range. REST: GET /api/v1/analytics/geo",
		scope: "analytics:read",
		inputSchema: siteArgs({ limit: limitProperty(50) }),
	},
	{
		name: "device_breakdown",
		description:
			"Visitors by device type, OS, and browser (top 10 each). REST: GET /api/v1/analytics/devices",
		scope: "analytics:read",
		inputSchema: siteArgs(),
	},
	{
		name: "revenue_breakdown",
		description:
			"Revenue by traffic source, by country, and over time (revenue events only). REST: GET /api/v1/analytics/revenue",
		scope: "analytics:read",
		inputSchema: siteArgs(),
	},
	{
		name: "campaigns",
		description:
			"UTM campaign performance: visitors, pageviews, conversions, revenue, conversion rate per utm_source/medium/campaign. REST: GET /api/v1/analytics/campaigns",
		scope: "analytics:read",
		inputSchema: siteArgs(),
	},
	{
		name: "visitor_journeys",
		description:
			"Recent visitor sessions with step-by-step event journeys, identified profile (name/email) when known. REST: GET /api/v1/analytics/journeys",
		scope: "analytics:read",
		inputSchema: siteArgs({ limit: limitProperty(20) }),
	},
	{
		name: "export_events",
		description:
			"Export raw rows (events, visitors, or sessions) for a site and range. Defaults to JSON; format=csv returns CSV text. Needs analytics:export scope. REST: GET /api/v1/analytics/export",
		scope: "analytics:export",
		inputSchema: siteArgs(
			{
				range: { ...rangeProperty, default: "30d" },
				type: {
					type: "string",
					default: "events",
					enum: ["events", "visitors", "sessions"],
					description: "Which rows to export",
				},
				event_type: {
					type: "string",
					description:
						"events only: filter by event_type (pageview/custom/conversion/payment/subscription)",
				},
				format: {
					type: "string",
					default: "json",
					enum: ["json", "csv"],
					description: "Output format",
				},
				limit: {
					type: "integer",
					default: 500,
					maximum: 1000,
					description: "events only: max rows (default 500, max 1000)",
				},
			},
			["site_id", "range"],
		),
	},
];

const defByName = new Map<string, ToolDef>(TOOL_DEFS.map((d) => [d.name, d]));

export function getToolDef(name: string): ToolDef | undefined {
	return defByName.get(name);
}

/** ToolDef minus internal fields — the shape returned by tools/list. */
export function publicToolDef(def: ToolDef): {
	name: string;
	description: string;
	inputSchema: unknown;
} {
	return { name: def.name, description: def.description, inputSchema: def.inputSchema };
}

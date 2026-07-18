import { RevKlikClient } from "./client";
import { AnalyticsResource } from "./resources/analytics";
import { SitesResource } from "./resources/sites";
import { TokensResource } from "./resources/tokens";

export type { RevKlikClientOptions } from "./client";
export { RevKlikClient, RevKlikError } from "./client";
export { AnalyticsResource } from "./resources/analytics";
export { SitesResource } from "./resources/sites";
export { TokensResource } from "./resources/tokens";

// Re-export all types
export type {
	CreateTokenRequest,
	CreateTokenResponse,
	DeviceBreakdown,
	DeviceEntry,
	GeoEntry,
	RevenueByCountry,
	RevenueBySource,
	RevenueResponse,
	RevenueTimeSeriesPoint,
	RevokeTokenResponse,
	Site,
	SourceEntry,
	StatsResponse,
	TimeSeriesPoint,
	TokenInfo,
	TopPage,
	WhoamiResponse,
} from "./types";

import type { WhoamiResponse } from "./types";

/**
 * RevKlik SDK — programmatic access to the RevKlik analytics platform.
 *
 * @example
 * ```ts
 * import { RevKlik } from "@revklik/sdk";
 *
 * const rv = new RevKlik({ token: "rvt_..." });
 *
 * // List sites
 * const sites = await rv.sites.list();
 *
 * // Get analytics overview
 * const stats = await rv.analytics.overview(sites[0].id, "7d");
 * ```
 */
export class RevKlik {
	public readonly sites: SitesResource;
	public readonly analytics: AnalyticsResource;
	public readonly tokens: TokensResource;

	private client: RevKlikClient;

	constructor(options: { token: string; baseUrl?: string }) {
		this.client = new RevKlikClient(options);
		this.sites = new SitesResource(this.client);
		this.analytics = new AnalyticsResource(this.client);
		this.tokens = new TokensResource(this.client);
	}

	/** Get information about the authenticated token and user. */
	whoami(): Promise<WhoamiResponse> {
		return this.client.request<WhoamiResponse>("GET", "/whoami");
	}
}

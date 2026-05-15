import { RevKlikClient, RevKlikError } from "./client";
import { SitesResource } from "./resources/sites";
import { AnalyticsResource } from "./resources/analytics";
import { TokensResource } from "./resources/tokens";

export { RevKlikClient, RevKlikError } from "./client";
export type { RevKlikClientOptions } from "./client";
export { SitesResource } from "./resources/sites";
export { AnalyticsResource } from "./resources/analytics";
export { TokensResource } from "./resources/tokens";

// Re-export all types
export type {
  Site,
  StatsResponse,
  TimeSeriesPoint,
  TopPage,
  SourceEntry,
  GeoEntry,
  DeviceEntry,
  DeviceBreakdown,
  RevenueBySource,
  RevenueByCountry,
  RevenueTimeSeriesPoint,
  RevenueResponse,
  WhoamiResponse,
  TokenInfo,
  CreateTokenRequest,
  CreateTokenResponse,
  RevokeTokenResponse,
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

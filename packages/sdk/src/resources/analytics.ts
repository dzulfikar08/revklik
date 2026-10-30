import type { RevKlikClient } from "../client";
import type {
	DeviceBreakdown,
	GeoEntry,
	RevenueResponse,
	SourceEntry,
	StatsResponse,
	TimeSeriesPoint,
	TopPage,
} from "../types";

export interface AnalyticsListParams {
	limit?: number;
}

type ExportType = "events" | "visitors" | "sessions";

export class AnalyticsResource {
	constructor(private client: RevKlikClient) {}

	/** Get overview stats (pageviews, visitors, sessions, bounce rate, revenue, conversions). */
	overview(siteId: string, range: string): Promise<StatsResponse> {
		return this.client.request<StatsResponse>("GET", "/analytics/overview", {
			site_id: siteId,
			range,
		});
	}

	/** Get timeseries data (pageviews and visitors by date). */
	timeseries(siteId: string, range: string): Promise<TimeSeriesPoint[]> {
		return this.client.request<TimeSeriesPoint[]>("GET", "/analytics/timeseries", {
			site_id: siteId,
			range,
		});
	}

	/** Get top pages by pageviews. */
	pages(siteId: string, range: string, params?: AnalyticsListParams): Promise<TopPage[]> {
		const q: Record<string, string> = { site_id: siteId, range };
		if (params?.limit) q.limit = String(params.limit);
		return this.client.request<TopPage[]>("GET", "/analytics/pages", q);
	}

	/** Get referrer/source breakdown. */
	referrers(siteId: string, range: string, params?: AnalyticsListParams): Promise<SourceEntry[]> {
		const q: Record<string, string> = { site_id: siteId, range };
		if (params?.limit) q.limit = String(params.limit);
		return this.client.request<SourceEntry[]>("GET", "/analytics/referrers", q);
	}

	/** Get geographic breakdown (country, region, city). */
	geo(siteId: string, range: string, params?: AnalyticsListParams): Promise<GeoEntry[]> {
		const q: Record<string, string> = { site_id: siteId, range };
		if (params?.limit) q.limit = String(params.limit);
		return this.client.request<GeoEntry[]>("GET", "/analytics/geo", q);
	}

	/** Get device, OS, and browser breakdown. */
	devices(siteId: string, range: string): Promise<DeviceBreakdown> {
		return this.client.request<DeviceBreakdown>("GET", "/analytics/devices", {
			site_id: siteId,
			range,
		});
	}

	/** Get revenue breakdown by source, country, and timeseries. */
	revenue(siteId: string, range: string): Promise<RevenueResponse> {
		return this.client.request<RevenueResponse>("GET", "/analytics/revenue", {
			site_id: siteId,
			range,
		});
	}

	/**
	 * Export analytics data. CSV (the default) resolves to the raw CSV text;
	 * `format: "json"` resolves to the parsed rows.
	 */
	export(
		siteId: string,
		range: string,
		options: { format: "json"; type?: ExportType },
	): Promise<Record<string, unknown>[]>;
	export(
		siteId: string,
		range: string,
		options?: { format?: "csv"; type?: ExportType },
	): Promise<string>;
	export(
		siteId: string,
		range: string,
		options?: { format?: "csv" | "json"; type?: ExportType },
	): Promise<string | Record<string, unknown>[]> {
		const q: Record<string, string> = {
			site_id: siteId,
			range,
			format: options?.format || "csv",
			type: options?.type || "events",
		};
		return this.client.request<string | Record<string, unknown>[]>("GET", "/analytics/export", q);
	}
}

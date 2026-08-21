// Types re-exported from the shared package for SDK consumers

export interface Site {
	id: string;
	name: string;
	domain: string;
	created_at: string;
}

export interface StatsResponse {
	pageviews: number;
	visitors: number;
	sessions: number;
	bounceRate: number;
	avgDuration: number;
	revenue: number;
	conversions: number;
}

export interface TimeSeriesPoint {
	date: string;
	pageviews: number;
	visitors: number;
}

export interface TopPage {
	path: string;
	pageviews: number;
	visitors: number;
}

export interface SourceEntry {
	source: string;
	visitors: number;
	percentage: number;
}

export interface GeoEntry {
	country: string | null;
	region: string | null;
	city: string | null;
	visitors: number;
}

export interface DeviceEntry {
	device: string;
	visitors: number;
	percentage: number;
}

export interface DeviceBreakdown {
	devices: DeviceEntry[];
	os: DeviceEntry[];
	browsers: DeviceEntry[];
}

export interface RevenueBySource {
	source: string;
	revenue: number;
	conversions: number;
}

export interface RevenueByCountry {
	country: string;
	revenue: number;
	conversions: number;
}

export interface RevenueTimeSeriesPoint {
	date: string;
	revenue: number;
	conversions: number;
}

export interface RevenueResponse {
	bySource: RevenueBySource[];
	byCountry: RevenueByCountry[];
	timeseries: RevenueTimeSeriesPoint[];
}

export interface WhoamiResponse {
	user: { id: string; name: string; email: string };
	plan: string;
	token: {
		type: "account" | "site";
		scopes: string[];
		site_id: string | null;
		name: string;
		created_at: string;
	};
}

export interface TokenInfo {
	id: string;
	prefix: string;
	name: string;
	type: "account" | "site";
	scopes: string[];
	site_id: string | null;
	last_used_at: string | null;
	created_at: string;
}

export interface CreateTokenRequest {
	name: string;
	type: "account" | "site";
	scopes?: string[];
	site_id?: string;
}

export interface CreateTokenResponse {
	id: string;
	token: string;
	prefix: string;
	name: string;
	type: "account" | "site";
	scopes: string[];
	site_id: string | null;
	created_at: string;
}

export interface RevokeTokenResponse {
	id: string;
	revoked: true;
}

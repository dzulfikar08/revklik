/**
 * Client endpoints for the App Store Connect integration (sales-report sync).
 * Price-change annotations flow through the regular annotations endpoint.
 */
import { legacyFetch } from "./api";

export interface AscTotals {
	downloads: number;
	proceeds: number;
	iap_units: number;
	iap_proceeds: number;
	currency: string | null;
}

export interface AscMetrics {
	totals: AscTotals;
	timeseries: Array<{
		date: string;
		downloads: number;
		proceeds: number;
		iap_proceeds: number;
	}>;
	byCountry: Array<{
		country: string;
		downloads: number;
		proceeds: number;
		price: number | null;
		currency: string | null;
	}>;
}

export interface AscPriceEntry {
	country: string;
	currency: string | null;
	price: number | null;
	since: string;
}

export const fetchAppStoreMetrics = (siteId: string, range: string): Promise<AscMetrics> =>
	legacyFetch(
		`/appstoreconnect/metrics?${new URLSearchParams({
			site_id: siteId,
			range,
		})}`,
	);

export const syncAppStore = (
	siteId: string,
	days?: number,
): Promise<{ app_id: string; days_synced: number; price_changes: number }> =>
	legacyFetch("/appstoreconnect/sync", {
		method: "POST",
		body: JSON.stringify({ site_id: siteId, days }),
	});

export const fetchAppStorePrices = (siteId: string): Promise<AscPriceEntry[]> =>
	legacyFetch(`/appstoreconnect/prices?site_id=${encodeURIComponent(siteId)}`);

/**
 * Offline render tests for the integrations page: the Payments tab opens first,
 * the App Store Connect form carries its acquisition instructions and every
 * config field, and Search Console rows collapse to one row per query.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { aggregateGscQueries, isSyncStale } from "@/lib/legacy/integrations";

import {
	IntegrationForm,
	IntegrationsView,
	WEBHOOK_PROVIDERS,
	fieldLabel,
} from "./integrations-view";

const ascMeta = WEBHOOK_PROVIDERS.find((p) => p.type === "appstoreconnect");
if (!ascMeta) throw new Error("appstoreconnect provider meta missing");

const render = (ui: React.ReactElement) =>
	renderToString(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("Integrations page", () => {
	it("opens on Payments and keeps the App Store Connect card under Apps", () => {
		const html = render(<IntegrationsView siteId="s1" />);
		expect(html).toContain("Connect payments, apps, search data and imports");
		for (const tab of ["Payments", "Apps", "Search", "Imports"]) {
			expect(html).toContain(`>${tab}</button>`);
		}
		expect(html).not.toContain("Webhooks</button>");
		expect(html).toMatch(/aria-selected="true"[^>]*>Payments</);
		expect(html).not.toContain("App Store Connect");
		expect(html).not.toContain("Pakasir");
		expect(html.toLowerCase()).not.toContain("nicepay");
		expect(html).not.toContain("Connect Shopee");
		expect(html).not.toContain("Tokopedia");
	});
});

describe("App Store Connect integration form", () => {
	it("renders step-by-step instructions for every required value", () => {
		const html = render(
			<IntegrationForm meta={ascMeta} integration={null} siteId="s1" onDone={() => {}} />,
		);
		expect(html).toContain("Step 1: create an API key");
		expect(html).toContain("Step 2: app and vendor numbers");
		expect(html).toContain("Users and Access → Integrations");
		expect(html).toContain("Paid Applications Agreement");
		expect(html).toContain("download it exactly once");
		expect(html).toContain("App Information → Apple ID");
		expect(html).toContain("top-left corner, under your Legal Entity Name");
	});

	it("renders all config fields with the .p8 as a textarea", () => {
		const html = render(
			<IntegrationForm meta={ascMeta} integration={null} siteId="s1" onDone={() => {}} />,
		);
		for (const field of ascMeta.fields) {
			expect(html).toContain(fieldLabel(field, t));
		}
		expect(html).toContain("<textarea");
		expect(html).toContain("-----BEGIN PRIVATE KEY-----");
		expect(html).toContain("Payments and Financial Reports");
	});

	it("describes what the card does", () => {
		expect(t(ascMeta.descriptionKey)).toContain(
			"Sync App Store downloads, proceeds, and price changes",
		);
	});
});

describe("Search Console aggregation", () => {
	const row = (
		query: string,
		date: string,
		clicks: number,
		impressions: number,
		position: number,
	) => ({
		clicks,
		ctr: impressions ? clicks / impressions : 0,
		date,
		impressions,
		position,
		query,
	});

	it("sums per query, weights position by impressions and sorts by clicks then impressions", () => {
		const out = aggregateGscQueries([
			row("analytics", "2026-10-01", 2, 100, 4),
			row("privacy", "2026-10-01", 9, 90, 2),
			row("analytics", "2026-10-02", 8, 300, 8),
			row("zero", "2026-10-02", 0, 10, 20),
			row("zero", "2026-10-03", 0, 50, 10),
		]);
		expect(out.map((r) => r.query)).toEqual(["analytics", "privacy", "zero"]);
		expect(out[0]?.clicks).toBe(10);
		expect(out[0]?.impressions).toBe(400);
		expect(out[0]?.ctr).toBeCloseTo(10 / 400);
		expect(out[0]?.position).toBeCloseTo((4 * 100 + 8 * 300) / 400);
		expect(out[2]?.position).toBeCloseTo((20 * 10 + 10 * 50) / 60);
	});

	it("flags a sync older than three days as stale", () => {
		const now = Date.parse("2026-10-30T12:00:00Z");
		expect(isSyncStale("2026-10-20T00:00:00Z", now)).toBe(true);
		expect(isSyncStale("2026-10-28T00:00:00Z", now)).toBe(false);
		expect(isSyncStale(null, now)).toBe(false);
	});
});

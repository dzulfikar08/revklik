import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { AscMetricsResponse, AscPriceEntry, KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { requireSiteAccess } from "../lib/site-access";
import {
	AscAuthError,
	AscConfigError,
	latestCountryPrices,
	syncAppStoreConnect,
} from "../lib/appstoreconnect";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const ascRoutes = new Hono<{ Bindings: Env["Bindings"]; Variables: Variables }>();

const RANGE_DAYS: Record<string, number> = {
	"24h": 2,
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"12m": 365,
};

// GET /metrics?site_id=&range=30d — App Store downloads/proceeds for the
// Revenue panel. Series merge into the same view as web revenue.
ascRoutes.get("/metrics", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;
	const days = RANGE_DAYS[c.req.query("range") ?? "30d"] ?? 30;
	const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

	const [rows, countryRows] = await Promise.all([
		db
			.selectFrom("asc_daily_metrics")
			.select(["date", "units", "proceeds", "iap_units", "iap_proceeds", "proceeds_currency"])
			.where("site_id", "=", siteId)
			.where("date", ">=", since)
			.orderBy("date", "asc")
			.execute(),
		db
			.selectFrom("asc_daily_country")
			.select(["country", "date", "units", "proceeds", "customer_price", "customer_currency"])
			.where("site_id", "=", siteId)
			.where("date", ">=", since)
			.orderBy("date", "asc")
			.execute(),
	]);

	const currencies = new Set(rows.map((r) => r.proceeds_currency).filter(Boolean) as string[]);
	const timeseries = rows.map((r) => ({
		date: r.date,
		downloads: r.units,
		proceeds: r.proceeds,
		iap_proceeds: r.iap_proceeds,
	}));
	const totals = {
		downloads: rows.reduce((a, r) => a + r.units, 0),
		proceeds: rows.reduce((a, r) => a + r.proceeds, 0),
		iap_units: rows.reduce((a, r) => a + r.iap_units, 0),
		iap_proceeds: rows.reduce((a, r) => a + r.iap_proceeds, 0),
		currency: currencies.size === 1 ? ([...currencies][0] ?? null) : null,
	};
	const byCountryMap = new Map<
		string,
		{
			country: string;
			downloads: number;
			proceeds: number;
			price: number | null;
			currency: string | null;
			priceDate: string;
		}
	>();
	for (const r of countryRows) {
		const cur = byCountryMap.get(r.country) ?? {
			country: r.country,
			downloads: 0,
			proceeds: 0,
			price: null,
			currency: null,
			priceDate: "",
		};
		cur.downloads += r.units;
		cur.proceeds += r.proceeds;
		if (r.customer_price !== null && r.date >= cur.priceDate) {
			cur.price = r.customer_price;
			cur.currency = r.customer_currency;
			cur.priceDate = r.date;
		}
		byCountryMap.set(r.country, cur);
	}
	const byCountry = [...byCountryMap.values()].map(({ priceDate: _d, ...r }) => r);

	const data: AscMetricsResponse = {
		totals,
		timeseries,
		byCountry,
	};
	return c.json({ data, success: true });
});

// GET /prices?site_id= — current tier price per country (from charged prices).
ascRoutes.get("/prices", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;
	const rows = await latestCountryPrices(db, siteId);
	const data: AscPriceEntry[] = rows
		.map((r) => ({
			country: r.country,
			currency: r.customer_currency,
			price: r.customer_price,
			since: r.date,
		}))
		.sort((a, b) => a.country.localeCompare(b.country));
	return c.json({ data, success: true });
});

// POST /sync { site_id, days? } — manual sync (cron runs the same logic).
ascRoutes.post("/sync", async (c) => {
	const db = c.get("db");
	const body = await c.req.json().catch(() => ({}));
	const { site_id, days } = body as { site_id?: string; days?: number };
	if (!site_id) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, site_id, "write");
	if (access instanceof Response) return access;

	const integration = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "user_id", "config", "last_sync"])
		.where("site_id", "=", site_id)
		.where("type", "=", "appstoreconnect")
		.where("enabled", "=", 1)
		.executeTakeFirst();
	if (!integration) {
		return c.json(
			{ error: "No enabled App Store Connect integration for this site", success: false },
			404,
		);
	}

	try {
		const result = await syncAppStoreConnect(db, integration, {
			days: typeof days === "number" ? days : undefined,
		});
		return c.json({ data: result, success: true });
	} catch (err) {
		if (err instanceof AscConfigError) {
			return c.json({ error: err.message, success: false }, 400);
		}
		if (err instanceof AscAuthError) {
			return c.json({ error: err.message, success: false }, 502);
		}
		throw err;
	}
});

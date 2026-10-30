import { Hono } from "hono";
import type { Env } from "../types";
import { odsDay, odsEventTimestamp } from "../lib/ods-import";
import { generateId } from "../utils";

export const importRoutes = new Hono<Env>();

// POST /onedollarstats — Import OneDollarStats data into site analytics
importRoutes.post("/onedollarstats", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
	const body = await c.req.json();
	const { site_id, api_key, ods_site_id, date_range } = body;
	if (!site_id || !api_key || !ods_site_id)
		return c.json({ error: "site_id, api_key, and ods_site_id required", success: false }, 400);

	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", site_id)
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.where("site_id", "=", site_id)
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null),
				),
			]),
		)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const range = date_range || "all";
	let imported = 0;

	const pageQuery = {
		site_id: ods_site_id,
		metrics: ["visitors", "pageviews"],
		date_range: range,
		dimensions: ["time:day", "event:page"],
		order_by: [["time:day", "asc"]],
		pagination: { limit: 10000 },
	};
	const pageRes = await fetch("https://api.onedollarstats.com/api", {
		method: "POST",
		headers: { "x-api-key": api_key, "Content-Type": "application/json" },
		body: JSON.stringify(pageQuery),
	});
	if (!pageRes.ok)
		return c.json({ error: `OneDollarStats API error: ${pageRes.status}`, success: false }, 502);
	const pageData = (await pageRes.json()) as {
		results: Array<{ metrics: number[]; dimensions: string[] }>;
	};

	const countryQuery = {
		site_id: ods_site_id,
		metrics: ["visitors"],
		date_range: range,
		dimensions: ["time:day", "visit:country_name"],
		order_by: [["time:day", "asc"]],
		pagination: { limit: 10000 },
	};
	const countryRes = await fetch("https://api.onedollarstats.com/api", {
		method: "POST",
		headers: { "x-api-key": api_key, "Content-Type": "application/json" },
		body: JSON.stringify(countryQuery),
	});
	const countryData = countryRes.ok
		? ((await countryRes.json()) as {
				results: Array<{ metrics: number[]; dimensions: string[] }>;
			})
		: { results: [] };

	const sourceQuery = {
		site_id: ods_site_id,
		metrics: ["visitors"],
		date_range: range,
		dimensions: ["time:day", "visit:source"],
		order_by: [["time:day", "asc"]],
		pagination: { limit: 10000 },
	};
	const sourceRes = await fetch("https://api.onedollarstats.com/api", {
		method: "POST",
		headers: { "x-api-key": api_key, "Content-Type": "application/json" },
		body: JSON.stringify(sourceQuery),
	});
	const sourceData = sourceRes.ok
		? ((await sourceRes.json()) as {
				results: Array<{ metrics: number[]; dimensions: string[] }>;
			})
		: { results: [] };

	const countryByDate = new Map<string, Map<string, number>>();
	for (const row of countryData.results) {
		const [rawDate, country] = row.dimensions as [string, string];
		const date = odsDay(rawDate);
		if (!date || !country) continue;
		if (!countryByDate.has(date)) countryByDate.set(date, new Map());
		countryByDate.get(date)?.set(country, row.metrics[0] ?? 0);
	}

	const sourceByDate = new Map<string, Map<string, number>>();
	for (const row of sourceData.results) {
		const [rawDate, source] = row.dimensions as [string, string];
		const date = odsDay(rawDate);
		if (!date || !source || source === "(not set)") continue;
		if (!sourceByDate.has(date)) sourceByDate.set(date, new Map());
		sourceByDate.get(date)?.set(source, row.metrics[0] ?? 0);
	}

	const countryToCode: Record<string, string> = {
		"United States": "US",
		"United States of America": "US",
		Netherlands: "NL",
		"Czech Republic": "CZ",
		Czechia: "CZ",
		Germany: "DE",
		"United Kingdom": "GB",
		France: "FR",
		Japan: "JP",
		Canada: "CA",
		Australia: "AU",
		Brazil: "BR",
		India: "IN",
		Indonesia: "ID",
		Russia: "RU",
		China: "CN",
		"South Korea": "KR",
		Spain: "ES",
		Italy: "IT",
		Poland: "PL",
		Sweden: "SE",
		Norway: "NO",
		Finland: "FI",
		Denmark: "DK",
		Turkey: "TR",
		Mexico: "MX",
		Argentina: "AR",
		Singapore: "SG",
		Ukraine: "UA",
		Belgium: "BE",
		Switzerland: "CH",
		Austria: "AT",
		Portugal: "PT",
		Ireland: "IE",
		Israel: "IL",
		Thailand: "TH",
		Philippines: "PH",
		Vietnam: "VN",
		Malaysia: "MY",
		Colombia: "CO",
		Chile: "CL",
		"South Africa": "ZA",
		"New Zealand": "NZ",
		Taiwan: "TW",
		"Hong Kong": "HK",
		Romania: "RO",
		Greece: "GR",
		Hungary: "HU",
	};

	for (const row of pageData.results) {
		const [rawDate, page] = row.dimensions as [string, string | undefined];
		const date = odsDay(rawDate);
		if (!date) continue;
		const pagePath = page || "/";
		const visitors = row.metrics[0];
		if (!visitors || visitors < 1) continue;

		const dayCountries = countryByDate.get(date) ?? new Map();
		const daySources = sourceByDate.get(date) ?? new Map();
		const totalCountryVisitors = [...dayCountries.values()].reduce((s, v) => s + v, 0) || visitors;
		const eventsToCreate = Math.min(visitors, 50);

		for (let i = 0; i < eventsToCreate; i++) {
			let country: string | null = null;
			if (dayCountries.size > 0) {
				let target = (i / eventsToCreate) * totalCountryVisitors;
				for (const [c, v] of dayCountries) {
					target -= v;
					if (target <= 0) {
						country = countryToCode[c] || c.substring(0, 2).toUpperCase();
						break;
					}
				}
			}
			let referrer: string | null = null;
			const totalSourceVisitors = [...daySources.values()].reduce((s, v) => s + v, 0) || 1;
			if (daySources.size > 0) {
				let target = (i / eventsToCreate) * totalSourceVisitors;
				for (const [s, v] of daySources) {
					target -= v;
					if (target <= 0) {
						referrer = s;
						break;
					}
				}
			}
			const visitorId = `ods_${date}_${pagePath.replace(/[^a-zA-Z0-9]/g, "_")}_${i}`;
			const ts = odsEventTimestamp(date, i);
			await db
				.insertInto("events")
				.values({
					id: generateId(),
					site_id,
					session_id: generateId(),
					visitor_id: visitorId,
					timestamp: ts,
					event_type: "pageview",
					name: null,
					path: pagePath,
					hostname: null,
					referrer,
					utm_source: null,
					utm_medium: null,
					utm_campaign: null,
					utm_term: null,
					utm_content: null,
					country,
					region: null,
					city: null,
					device_type: null,
					browser: null,
					os: null,
					revenue: null,
					props: JSON.stringify({
						source: "onedollarstats_import",
						ods_visitors: visitors,
						ods_pageviews: row.metrics[1],
					}),
					fingerprint: null,
				})
				.execute();
			imported++;
		}
	}
	return c.json({
		success: true,
		data: {
			imported,
			note: "Created synthetic pageview events from aggregated ODS data",
		},
	});
});

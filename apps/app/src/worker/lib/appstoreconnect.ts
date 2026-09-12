/**
 * App Store Connect integration — sales-report sync + price-change detection.
 *
 * Auth: ASC API keys (JWT ES256 signed with the account .p8) — no OAuth.
 * Data source of truth: `GET /v1/salesReports` DAILY SALES SUMMARY (TSV),
 * which carries per-country units and per-unit prices for the last 13 months.
 * The per-unit Customer Price is the tier price actually charged that day, so
 * consecutive-day diffs double as price-change history — no separate price
 * polling needed. App Store Engagement analytics (impressions / page views /
 * paying users) is layered on when its report request has finished generating.
 */
import type { Kysely } from "kysely";
import type { AscDailyCountryTable, IntegrationTable, KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";

const ASC_API = "https://api.appstoreconnect.apple.com";

export interface AscConfig {
	issuer_id: string;
	key_id: string;
	private_key: string;
	app_id: string;
	vendor_number: string;
	/** First-sync lookback in days (max 90). Default 30. */
	backfill_days?: string;
}

export class AscConfigError extends Error {}

/** Thrown on 401/403 from Apple — config is wrong, sync must surface it. */
export class AscAuthError extends Error {}

/* --------------------------------- config --------------------------------- */

export function parseAscConfig(config: Record<string, unknown>): AscConfig {
	const cfg = config as unknown as AscConfig;
	for (const field of ["issuer_id", "key_id", "private_key", "app_id", "vendor_number"] as const) {
		if (!cfg[field] || typeof cfg[field] !== "string") {
			throw new AscConfigError(
				`Integration config is missing "${field}" (issuer_id, key_id, private_key, app_id, vendor_number)`,
			);
		}
	}
	return cfg;
}

/* ----------------------------------- JWT ---------------------------------- */

function b64url(input: string | Uint8Array): string {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
	const body = pem
		.replace(/-----BEGIN [^-]+-----/, "")
		.replace(/-----END [^-]+-----/, "")
		.replace(/\s+/g, "");
	const raw = atob(body);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

/** Sign an ES256 App Store Connect token (≤20 min validity, per spec). */
export async function signAscToken(
	cfg: Pick<AscConfig, "issuer_id" | "key_id" | "private_key">,
	now = Date.now(),
): Promise<string> {
	let key: CryptoKey;
	try {
		key = await crypto.subtle.importKey(
			"pkcs8",
			pemToPkcs8(cfg.private_key),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["sign"],
		);
	} catch {
		throw new AscConfigError("private_key is not a valid .p8 (PKCS#8 PEM) private key");
	}
	const iat = Math.floor(now / 1000) - 30;
	const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.key_id, typ: "JWT" }));
	const payload = b64url(
		JSON.stringify({ iss: cfg.issuer_id, iat, exp: iat + 1200, aud: "appstoreconnect-v1" }),
	);
	const sig = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/* ------------------------------ sales reports ------------------------------ */

export interface AscSalesRow {
	date: string;
	country: string;
	units: number;
	proceeds: number;
	proceedsCurrency: string;
	customerPrice: number | null;
	customerCurrency: string;
	isIap: boolean;
	appleId: string;
}

/** "09/07/2026" (Apple's Begin/End Date format) → "2026-09-07". */
export function appleDateToIso(raw: string): string | null {
	const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
	if (!m) return null;
	return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Parse a SALES / SUMMARY / DAILY (version 1_3) TSV report. Column positions
 * vary between report versions, so the header row is indexed by name.
 * "Developer Proceeds Extended" (row total) is preferred over the per-unit
 * "Developer Proceeds" when present.
 */
export function parseSalesReportTsv(tsv: string): AscSalesRow[] {
	const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
	if (lines.length < 2) return [];
	const header = lines[0].split("\t").map((h) => h.trim());
	const col = (name: string) => header.indexOf(name);
	const idx = {
		appleId: col("Apple Identifier"),
		beginDate: col("Begin Date"),
		country: col("Country Code"),
		units: col("Units"),
		proceedsUnit: col("Developer Proceeds"),
		proceedsExt: col("Developer Proceeds Extended"),
		proceedsCurrency: col("Currency of Proceeds"),
		customerPrice: col("Customer Price"),
		customerCurrency: col("Customer Currency"),
		productType: col("Product Type Identifier"),
	};
	if (idx.beginDate < 0 || idx.country < 0 || idx.units < 0) return [];

	const rows: AscSalesRow[] = [];
	for (const line of lines.slice(1)) {
		const cells = line.split("\t");
		const date = appleDateToIso(cells[idx.beginDate] ?? "");
		if (!date) continue;
		const units = Number.parseInt(cells[idx.units] ?? "0", 10) || 0;
		const productType = (cells[idx.productType] ?? "").trim();
		// Download-like types: 1 (paid/free download), 7 (update), 8
		// (re-download), 3-6 (Mac/TV variants). Anything containing "F" is an
		// in-app purchase or subscription event.
		const isIap = /F/.test(productType);
		if (!isIap && !/^[1345678]$/.test(productType)) continue;
		const proceeds =
			Number.parseFloat(cells[idx.proceedsExt] ?? "") ||
			units * (Number.parseFloat(cells[idx.proceedsUnit] ?? "") || 0);
		const customerRaw = idx.customerPrice >= 0 ? cells[idx.customerPrice] : "";
		rows.push({
			date,
			country: (cells[idx.country] ?? "").trim(),
			units,
			proceeds,
			proceedsCurrency: (cells[idx.proceedsCurrency] ?? "").trim(),
			customerPrice: customerRaw ? Number.parseFloat(customerRaw) || null : null,
			customerCurrency: (cells[idx.customerCurrency] ?? "").trim(),
			isIap,
			appleId: (cells[idx.appleId] ?? "").trim(),
		});
	}
	return rows;
}

export interface AscDayAgg {
	date: string;
	units: number;
	proceeds: number;
	iapUnits: number;
	iapProceeds: number;
	proceedsCurrency: string | null;
}

export interface AscCountryAgg {
	date: string;
	country: string;
	units: number;
	proceeds: number;
	customerPrice: number | null;
	customerCurrency: string | null;
}

export function aggregateSalesRows(
	rows: AscSalesRow[],
	appleId?: string,
): { days: AscDayAgg[]; countries: AscCountryAgg[] } {
	const filtered = appleId ? rows.filter((r) => !r.appleId || r.appleId === appleId) : rows;
	const days = new Map<string, AscDayAgg>();
	const countries = new Map<string, AscCountryAgg>();
	for (const r of filtered) {
		const d = days.get(r.date) ?? {
			date: r.date,
			units: 0,
			proceeds: 0,
			iapUnits: 0,
			iapProceeds: 0,
			proceedsCurrency: null,
		};
		if (!d.proceedsCurrency && r.proceedsCurrency) d.proceedsCurrency = r.proceedsCurrency;
		if (r.isIap) {
			d.iapUnits += r.units;
			d.iapProceeds += r.proceeds;
		} else {
			d.units += r.units;
			d.proceeds += r.proceeds;
		}
		days.set(r.date, d);

		if (!r.country) continue;
		const key = `${r.date}|${r.country}`;
		const c = countries.get(key) ?? {
			date: r.date,
			country: r.country,
			units: 0,
			proceeds: 0,
			customerPrice: null,
			customerCurrency: null,
		};
		c.units += r.units;
		c.proceeds += r.proceeds;
		// App-tier price: non-IAP rows with actual sales.
		if (!r.isIap && r.units > 0 && r.customerPrice !== null) {
			c.customerPrice = r.customerPrice;
			c.customerCurrency = r.customerCurrency || c.customerCurrency;
		}
		countries.set(key, c);
	}
	return { days: [...days.values()], countries: [...countries.values()] };
}

/* ----------------------------- price detection ----------------------------- */

export interface AscPriceChange {
	country: string;
	date: string;
	from: number;
	to: number;
	currency: string | null;
}

/**
 * Diff consecutive sale days per country: a change in the per-unit Customer
 * Price between two days with units > 0 is a price change. Days without
 * sales carry no price signal and are skipped.
 */
export function detectPriceChanges(countries: AscCountryAgg[]): AscPriceChange[] {
	const byCountry = new Map<string, AscCountryAgg[]>();
	for (const c of countries) {
		if (c.units <= 0 || c.customerPrice === null) continue;
		const list = byCountry.get(c.country) ?? [];
		list.push(c);
		byCountry.set(c.country, list);
	}
	const changes: AscPriceChange[] = [];
	for (const [country, list] of byCountry) {
		list.sort((a, b) => (a.date < b.date ? -1 : 1));
		let last: AscCountryAgg | null = null;
		for (const c of list) {
			if (last && c.customerPrice !== last.customerPrice) {
				changes.push({
					country,
					date: c.date,
					from: last.customerPrice ?? 0,
					to: c.customerPrice ?? 0,
					currency: c.customerCurrency || null,
				});
			}
			last = c;
		}
	}
	return changes.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const fmtPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function priceChangeAnnotationText(ch: AscPriceChange): string {
	const cur = ch.currency ? ` ${ch.currency}` : "";
	return `App Store price change — ${ch.country}: ${fmtPrice(ch.from)} → ${fmtPrice(ch.to)}${cur}`;
}

/* --------------------------- App Store Engagement -------------------------- */

export interface AscEngagementDay {
	date: string;
	impressions: number | null;
	pageViews: number | null;
	payingUsers: number | null;
}

/** Parse "USD 1,234" / "USD 1.234,56" / "USD 12,34" style amounts. */
export function parseMoneyCurrency(raw: string): { currency: string; amount: number } | null {
	const m = /^([A-Z]{3})\s*([\d.,\u00A0\u202F'\s-]+)$/.exec(raw.trim());
	if (!m) return null;
	let num = m[2].replace(/[\u00A0\u202F\s'-]/g, "");
	if (num.includes(",") && num.includes(".")) {
		num =
			num.lastIndexOf(",") > num.lastIndexOf(".")
				? num.replace(/\./g, "").replace(",", ".")
				: num.replace(/,/g, "");
	} else if (num.includes(",")) {
		num = /,\d{3}(?:\D|$)/.test(num) ? num.replace(/,/g, "") : num.replace(",", ".");
	}
	const amount = Number.parseFloat(num);
	return Number.isFinite(amount) ? { currency: m[1], amount } : null;
}

/** Minimal CSV reader (handles quoted fields with commas/newlines). */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += ch;
		} else if (ch === '"') inQuotes = true;
		else if (ch === ",") {
			row.push(field);
			field = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			if (row.length > 1 || row[0] !== "") rows.push(row);
			row = [];
		} else field += ch;
	}
	row.push(field);
	if (row.length > 1 || row[0] !== "") rows.push(row);
	return rows;
}

/**
 * Parse an "App Store Engagement" DAILY CSV into per-day metrics. Columns are
 * matched by header name — Apple adds columns across report versions.
 */
export function parseEngagementCsv(text: string, appleId: string): AscEngagementDay[] {
	const rows = parseCsv(text);
	if (rows.length < 2) return [];
	const header = rows[0].map((h) => h.trim().toLowerCase());
	const find = (...names: RegExp[]) => {
		for (const re of names) {
			const i = header.findIndex((h) => re.test(h));
			if (i >= 0) return i;
		}
		return -1;
	};
	const idx = {
		date: find(/^date$/),
		app: find(/^(apple identifier|app)$/, /^app id$/),
		impressions: find(/^impressions/),
		pageViews: find(/^(page views|product page views)/),
		paying: find(/^paying users?$/),
		proceeds: find(/^proceeds/),
	};
	if (idx.date < 0) return [];
	const intAt = (cells: string[], i: number) =>
		i >= 0 ? Number.parseInt((cells[i] ?? "").replace(/[^\d-]/g, ""), 10) || null : null;

	const days = new Map<string, AscEngagementDay>();
	for (const cells of rows.slice(1)) {
		if (idx.app >= 0 && (cells[idx.app] ?? "").trim() !== appleId) continue;
		const date = appleDateToIso(cells[idx.date] ?? "") ?? (cells[idx.date] ?? "").trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		const money = idx.proceeds >= 0 ? parseMoneyCurrency(cells[idx.proceeds] ?? "") : null;
		if (money === null && idx.impressions < 0 && idx.pageViews < 0 && idx.paying < 0) continue;
		const d = days.get(date) ?? { date, impressions: null, pageViews: null, payingUsers: null };
		const imp = intAt(cells, idx.impressions);
		const pv = intAt(cells, idx.pageViews);
		const pay = intAt(cells, idx.paying);
		if (imp !== null) d.impressions = (d.impressions ?? 0) + imp;
		if (pv !== null) d.pageViews = (d.pageViews ?? 0) + pv;
		if (pay !== null) d.payingUsers = (d.payingUsers ?? 0) + pay;
		days.set(date, d);
	}
	return [...days.values()];
}

/* --------------------------------- API I/O --------------------------------- */

/** Shared subrequest budget (Workers free tier allows 50/invocation). */
export interface FetchBudget {
	n: number;
	max: number;
}

async function ascFetch(path: string, token: string, budget: FetchBudget): Promise<Response> {
	if (budget.n >= budget.max) throw new AscAuthError("__budget__");
	budget.n++;
	const res = await fetch(`${ASC_API}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (res.status === 401 || res.status === 403) {
		throw new AscAuthError(
			"Apple rejected the API key (401/403) — check issuer_id, key_id, the .p8 key, and its role",
		);
	}
	return res;
}

async function ensureEngagementReportRequest(
	cfg: AscConfig,
	token: string,
	budget: FetchBudget,
): Promise<string | null> {
	const listRes = await ascFetch(`/v1/apps/${cfg.app_id}/analyticsReportRequests`, token, budget);
	const list = (await listRes.json().catch(() => null)) as {
		data?: Array<{ id: string; attributes?: { name?: string; state?: string } }>;
	} | null;
	const existing = list?.data?.find((r) => r.attributes?.name === "App Store Engagement");
	if (existing) {
		return existing.attributes?.state === "ORPHANED" || existing.attributes?.state === "DELETED"
			? null
			: existing.id;
	}
	const createRes = await fetch(`${ASC_API}/v1/analyticsReportRequests`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			data: {
				type: "analyticsReportRequests",
				attributes: { accessType: "ONGOING", name: "App Store Engagement" },
				relationships: { app: { data: { type: "apps", id: cfg.app_id } } },
			},
		}),
	});
	if (!createRes.ok) {
		// 409 = already requested; anything else (403 = role too weak) is fatal
		// for this section but must not fail the sales sync.
		console.log(`ASC analytics request create: HTTP ${createRes.status}`);
		return null;
	}
	const created = (await createRes.json().catch(() => null)) as {
		data?: { id?: string };
	} | null;
	return created?.data?.id ?? null;
}

/* ---------------------------------- sync ---------------------------------- */

export interface AscSyncResult {
	app_id: string;
	days_synced: number;
	days_skipped: number;
	price_changes: number;
	analytics_days: number;
}

const isoDaysAgo = (n: number): string =>
	new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

async function upsertDays(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	appId: string,
	days: AscDayAgg[],
): Promise<void> {
	if (!days.length) return;
	const now = new Date().toISOString();
	await db
		.insertInto("asc_daily_metrics")
		.values(
			days.map((d) => ({
				id: generateId(),
				site_id: siteId,
				app_id: appId,
				date: d.date,
				units: d.units,
				proceeds: d.proceeds,
				iap_units: d.iapUnits,
				iap_proceeds: d.iapProceeds,
				proceeds_currency: d.proceedsCurrency,
				synced_at: now,
			})),
		)
		.onConflict((oc) =>
			oc.columns(["site_id", "app_id", "date"]).doUpdateSet((eb) => ({
				units: eb.ref("excluded.units"),
				proceeds: eb.ref("excluded.proceeds"),
				iap_units: eb.ref("excluded.iap_units"),
				iap_proceeds: eb.ref("excluded.iap_proceeds"),
				proceeds_currency: eb.ref("excluded.proceeds_currency"),
				synced_at: eb.ref("excluded.synced_at"),
			})),
		)
		.execute();
}

async function upsertCountries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	appId: string,
	countries: AscCountryAgg[],
): Promise<void> {
	if (!countries.length) return;
	const now = new Date().toISOString();
	await db
		.insertInto("asc_daily_country")
		.values(
			countries.map((c) => ({
				id: generateId(),
				site_id: siteId,
				app_id: appId,
				date: c.date,
				country: c.country,
				units: c.units,
				proceeds: c.proceeds,
				customer_price: c.customerPrice,
				customer_currency: c.customerCurrency,
				synced_at: now,
			})),
		)
		.onConflict((oc) =>
			oc.columns(["site_id", "app_id", "date", "country"]).doUpdateSet((eb) => ({
				units: eb.ref("excluded.units"),
				proceeds: eb.ref("excluded.proceeds"),
				customer_price: eb.ref("excluded.customer_price"),
				customer_currency: eb.ref("excluded.customer_currency"),
				synced_at: eb.ref("excluded.synced_at"),
			})),
		)
		.execute();
}

async function recordPriceChangeAnnotations(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	userId: string,
	changes: AscPriceChange[],
): Promise<number> {
	let inserted = 0;
	for (const ch of changes) {
		const text = priceChangeAnnotationText(ch);
		const existing = await db
			.selectFrom("annotations")
			.select("id")
			.where("site_id", "=", siteId)
			.where("date", "=", ch.date)
			.where("text", "=", text)
			.executeTakeFirst();
		if (existing) continue;
		await db
			.insertInto("annotations")
			.values({
				id: generateId(),
				site_id: siteId,
				date: ch.date,
				text,
				user_id: userId,
				created_at: new Date().toISOString(),
			})
			.execute();
		inserted++;
	}
	return inserted;
}

/**
 * Sync one appstoreconnect integration: sales reports for the lookback window
 * (7 days steady-state, longer on first sync / manual run), price-change
 * annotations from per-unit price diffs, then engagement metrics while
 * subrequest budget remains. Idempotent — every day is upserted.
 */
export async function syncAppStoreConnect(
	db: Kysely<KlikapaDatabase>,
	integration: Pick<IntegrationTable, "id" | "site_id" | "user_id" | "config" | "last_sync">,
	opts: { days?: number; budget?: FetchBudget } = {},
): Promise<AscSyncResult> {
	const cfg = parseAscConfig(JSON.parse(integration.config || "{}"));
	const budget = opts.budget ?? { n: 0, max: 40 };
	const windowDays = Math.max(
		1,
		Math.min(
			opts.days ??
				(integration.last_sync ? 7 : Number.parseInt(cfg.backfill_days ?? "30", 10) || 30),
			90,
		),
	);
	const token = await signAscToken(cfg);
	const result: AscSyncResult = {
		app_id: cfg.app_id,
		days_synced: 0,
		days_skipped: 0,
		price_changes: 0,
		analytics_days: 0,
	};
	const allCountries: AscCountryAgg[] = [];

	for (let i = windowDays - 1; i >= 0; i--) {
		const date = isoDaysAgo(i);
		let res: Response;
		try {
			res = await ascFetch(
				`/v1/salesReports?filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[frequency]=DAILY&filter[reportDate]=${date}&filter[version]=1_3&filter[vendorNumber]=${encodeURIComponent(cfg.vendor_number)}`,
				token,
				budget,
			);
		} catch (err) {
			if (err instanceof AscAuthError && err.message === "__budget__") break;
			throw err;
		}
		if (res.status === 404) {
			// Report not generated yet (lands ~8am Pacific next day) — skip.
			result.days_skipped++;
			continue;
		}
		if (!res.ok) {
			console.log(`ASC sales report ${date}: HTTP ${res.status}`);
			result.days_skipped++;
			continue;
		}
		const tsv = await res.text();
		const { days, countries } = aggregateSalesRows(parseSalesReportTsv(tsv), cfg.app_id);
		await upsertDays(db, integration.site_id, cfg.app_id, days);
		await upsertCountries(db, integration.site_id, cfg.app_id, countries);
		allCountries.push(...countries);
		result.days_synced++;
	}

	result.price_changes = await recordPriceChangeAnnotations(
		db,
		integration.site_id,
		integration.user_id,
		detectPriceChanges(allCountries),
	);

	// Engagement metrics (impressions / page views / paying users). Best-effort:
	// the report request takes 1-2 days to activate after first sync.
	if (budget.n < budget.max) {
		try {
			const reqId = await ensureEngagementReportRequest(cfg, token, budget);
			if (reqId) {
				const since = isoDaysAgo(windowDays);
				const reportsRes = await ascFetch(
					`/v1/analyticsReportRequests/${reqId}/reports?filter[reportType]=App%20Store%20Engagement`,
					token,
					budget,
				);
				const reports = (await reportsRes.json().catch(() => null)) as {
					data?: Array<{ id: string }>;
				} | null;
				for (const report of reports?.data ?? []) {
					if (budget.n >= budget.max) break;
					const instRes = await ascFetch(
						`/v1/analyticsReports/${report.id}/instances`,
						token,
						budget,
					);
					const instances = (await instRes.json().catch(() => null)) as {
						data?: Array<{ id: string; attributes?: { granularity?: string } }>;
					} | null;
					for (const inst of (instances?.data ?? []).filter(
						(x) => !x.attributes?.granularity || x.attributes.granularity === "DAILY",
					)) {
						if (budget.n >= budget.max) break;
						const segRes = await ascFetch(
							`/v1/analyticsReportInstances/${inst.id}/segments`,
							token,
							budget,
						);
						const segments = (await segRes.json().catch(() => null)) as {
							data?: Array<{ id: string; attributes?: { url?: string } }>;
						} | null;
						for (const seg of segments?.data ?? []) {
							if (!seg.attributes?.url || budget.n >= budget.max) continue;
							budget.n++;
							const csvRes = await fetch(seg.attributes.url);
							if (!csvRes.ok) continue;
							const csv = await csvRes.text();
							const days = parseEngagementCsv(csv, cfg.app_id).filter((d) => d.date >= since);
							if (days.length) {
								await db
									.insertInto("asc_daily_metrics")
									.values(
										days.map((d) => ({
											id: generateId(),
											site_id: integration.site_id,
											app_id: cfg.app_id,
											date: d.date,
											units: 0,
											proceeds: 0,
											iap_units: 0,
											iap_proceeds: 0,
											proceeds_currency: null,
											impressions: d.impressions,
											page_views: d.pageViews,
											paying_users: d.payingUsers,
											synced_at: new Date().toISOString(),
										})),
									)
									// Engagement update must not clobber sales figures
									// already stored for the same day.
									.onConflict((oc) =>
										oc.columns(["site_id", "app_id", "date"]).doUpdateSet((eb) => ({
											impressions: eb.ref("excluded.impressions"),
											page_views: eb.ref("excluded.page_views"),
											paying_users: eb.ref("excluded.paying_users"),
										})),
									)
									.execute();
								result.analytics_days += days.length;
							}
						}
					}
				}
			}
		} catch (err) {
			console.log("ASC engagement sync skipped:", err instanceof Error ? err.message : err);
		}
	}

	await db
		.updateTable("integrations")
		.set({ last_sync: new Date().toISOString() })
		.where("id", "=", integration.id)
		.execute();

	return result;
}

/** Cron entry: sync every enabled appstoreconnect integration. */
export async function syncAllAppStoreConnect(db: Kysely<KlikapaDatabase>): Promise<void> {
	const integrations = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "user_id", "config", "last_sync"])
		.where("type", "=", "appstoreconnect")
		.where("enabled", "=", 1)
		.execute();
	if (!integrations.length) return;
	// One shared budget per cron invocation — sales reports win over analytics.
	const budget: FetchBudget = { n: 0, max: 45 };
	for (const integration of integrations) {
		try {
			const r = await syncAppStoreConnect(db, integration, { budget });
			console.log(
				`ASC sync site=${integration.site_id}: ${r.days_synced}d synced, ${r.days_skipped}d skipped, ${r.price_changes} price changes, ${r.analytics_days}d engagement`,
			);
		} catch (err) {
			console.error(
				`ASC sync failed site=${integration.site_id}:`,
				err instanceof Error ? err.message : err,
			);
		}
	}
}

/** Latest per-country price rows (read endpoint helper). */
export async function latestCountryPrices(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
): Promise<
	Pick<AscDailyCountryTable, "country" | "customer_price" | "customer_currency" | "date">[]
> {
	const rows = await db
		.selectFrom("asc_daily_country")
		.select(["country", "customer_price", "customer_currency", "date"])
		.where("site_id", "=", siteId)
		.where("customer_price", "is not", null)
		.orderBy("date", "desc")
		.execute();
	const seen = new Set<string>();
	return rows.filter((r) => {
		if (seen.has(r.country)) return false;
		seen.add(r.country);
		return true;
	});
}

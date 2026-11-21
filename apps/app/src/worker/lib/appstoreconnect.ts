/**
 * App Store Connect integration — sales-report sync + price-change detection.
 *
 * Auth: ASC API keys (JWT ES256 signed with the account .p8) — no OAuth.
 * Data source of truth: `GET /v1/salesReports` DAILY SALES SUMMARY (version 1_1,
 * gzipped TSV), which carries per-country units and per-unit prices for the last
 * 13 months. Proceeds arrive in each storefront's currency and are stored in USD.
 * The per-unit Customer Price is the tier price actually charged that day, so
 * consecutive-day diffs double as price-change history — no separate price
 * polling needed. Impressions and product page views (total and per source) come
 * from the Analytics Reports API "App Store Discovery and Engagement Standard"
 * report, once Apple has generated it for the app's report requests.
 */
import type { Kysely } from "kysely";
import type { AscDailyCountryTable, IntegrationTable, KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import { convertAmount, loadUsdRates, usdRates, type FxRates } from "./fx";

const ASC_API = "https://api.appstoreconnect.apple.com";

export interface AscConfig {
	issuer_id: string;
	key_id: string;
	private_key: string;
	app_id: string;
	vendor_number: string;
	/** First-sync lookback in days (max 90). Default 30. */
	backfill_days?: string;
	/** The app's SKU (in-app purchase rows reference it). Written by the sync. */
	app_sku?: string;
	/** Per analytics report request: newest report instance (processingDate) stored. Written by the sync. */
	engagement_cursor?: Record<string, string>;
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
	/** SKU of the app an in-app purchase belongs to ("Parent Identifier"). */
	parentSku: string;
}

/** "09/07/2026" (Apple's Begin/End Date format) → "2026-09-07". */
export function appleDateToIso(raw: string): string | null {
	const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
	if (!m) return null;
	return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Parse a SALES / SUMMARY / DAILY (version 1_1) TSV report. Column positions
 * vary between report versions, so the header row is indexed by name.
 * "Developer Proceeds Extended" (row total) is preferred over the per-unit
 * "Developer Proceeds" when present.
 */
/**
 * Apple product type identifiers. First-time app downloads: 1 (iPhone/iOS), 1F
 * (universal), 1T (iPad), F1 (Mac), 1E/1EP/1EU (custom apps). Updates (7, 7F, 7T,
 * F7) and re-downloads (3, 3F, 3T, F3) are not sales. In-app purchases and
 * subscriptions start with IA (iOS) or FI (Mac).
 */
const APP_DOWNLOAD_TYPE = /^(1|1F|1T|F1|1E|1EP|1EU)$/;
const IAP_TYPE = /^(IA|FI)/;

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
		parent: col("Parent Identifier"),
	};
	if (idx.beginDate < 0 || idx.country < 0 || idx.units < 0) return [];

	const rows: AscSalesRow[] = [];
	for (const line of lines.slice(1)) {
		const cells = line.split("\t");
		const date = appleDateToIso(cells[idx.beginDate] ?? "");
		if (!date) continue;
		const units = Number.parseInt(cells[idx.units] ?? "0", 10) || 0;
		const productType = (cells[idx.productType] ?? "").trim();
		const isIap = IAP_TYPE.test(productType);
		if (!isIap && !APP_DOWNLOAD_TYPE.test(productType)) continue;
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
			parentSku: idx.parent >= 0 ? (cells[idx.parent] ?? "").trim() : "",
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

/**
 * Per-day and per-country totals for one app. In-app purchase rows carry their own
 * Apple Identifier, so they are matched to the app by its SKU (their Parent
 * Identifier). Proceeds are converted to USD: one report mixes every storefront's
 * currency. Customer prices stay in the customer's currency (price-change detection).
 */
export function aggregateSalesRows(
	rows: AscSalesRow[],
	appleId?: string,
	opts: { appSku?: string; rates?: FxRates } = {},
): { days: AscDayAgg[]; countries: AscCountryAgg[] } {
	const rates = opts.rates ?? usdRates();
	const filtered = (
		appleId
			? rows.filter(
					(r) =>
						!r.appleId ||
						r.appleId === appleId ||
						(r.isIap && !!opts.appSku && r.parentSku === opts.appSku),
				)
			: rows
	).map((r) => ({
		...r,
		proceeds: r.proceedsCurrency
			? convertAmount(r.proceeds, r.proceedsCurrency, "USD", rates)
			: r.proceeds,
		proceedsCurrency: r.proceedsCurrency ? "USD" : r.proceedsCurrency,
	}));
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

/** Report rows are split by source; "" is the whole day. */
export interface AscEngagementRow {
	date: string;
	source: string;
	impressions: number;
	pageViews: number;
}

/** Minimal delimited-text reader (quoted fields with delimiters/newlines). Comma by default. */
export function parseCsv(text: string, delimiter = ","): string[][] {
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
		else if (ch === delimiter) {
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
 * Parse an "App Store Discovery and Engagement Standard" report segment: one row
 * per date, app, event (Impression, Page view, Tap, ...), page type, source type,
 * device, territory..., with a "Counts" column. Apple ships it as tab-separated
 * text; commas are accepted too. Columns are found by header name. Returns one
 * row per date with source "" (the day's total) plus one per date and source.
 */
export function parseEngagementReport(text: string, appleId: string): AscEngagementRow[] {
	const firstLine = text.slice(0, text.search(/\r?\n|$/));
	const rows = parseCsv(text, firstLine.includes("\t") ? "\t" : ",");
	if (rows.length < 2) return [];
	const header = rows[0].map((h) => h.trim().toLowerCase());
	const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
	const idx = {
		date: col("date"),
		app: col("app apple identifier", "apple identifier", "app id"),
		event: col("event"),
		source: col("source type"),
		counts: col("counts"),
	};
	if (idx.date < 0 || idx.event < 0 || idx.counts < 0) return [];

	const out = new Map<string, AscEngagementRow>();
	const add = (date: string, source: string, kind: "impressions" | "pageViews", n: number) => {
		const key = `${date}|${source}`;
		const row = out.get(key) ?? { date, source, impressions: 0, pageViews: 0 };
		row[kind] += n;
		out.set(key, row);
	};
	for (const cells of rows.slice(1)) {
		if (idx.app >= 0 && (cells[idx.app] ?? "").trim() !== appleId) continue;
		const rawDate = (cells[idx.date] ?? "").trim();
		const date = appleDateToIso(rawDate) ?? rawDate;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		const event = (cells[idx.event] ?? "").trim().toLowerCase();
		const kind =
			event === "impression" ? "impressions" : event === "page view" ? "pageViews" : null;
		if (!kind) continue;
		const n = Number.parseInt((cells[idx.counts] ?? "").replace(/[^\d-]/g, ""), 10) || 0;
		add(date, "", kind, n);
		const source = idx.source >= 0 ? (cells[idx.source] ?? "").trim() : "";
		if (source) add(date, source, kind, n);
	}
	return [...out.values()];
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

/** Apple serves reports as gzip files (on top of any transport encoding fetch already undid). */
export async function readReportText(res: Response): Promise<string> {
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
		return await new Response(stream).text();
	}
	return new TextDecoder().decode(bytes);
}

const ENGAGEMENT_REPORT = "App Store Discovery and Engagement Standard";

/**
 * The app's analytics report requests: the ONGOING one (daily data from now on) and,
 * when present, a ONE_TIME_SNAPSHOT (history). Only an Admin key may create them, so
 * a missing ONGOING request is created when the key allows it; otherwise the sync
 * logs that someone with Admin access has to create it once.
 */
async function engagementRequestIds(
	cfg: AscConfig,
	token: string,
	budget: FetchBudget,
): Promise<string[]> {
	const listRes = await ascFetch(`/v1/apps/${cfg.app_id}/analyticsReportRequests`, token, budget);
	const list = (await listRes.json().catch(() => null)) as {
		data?: Array<{
			id: string;
			attributes?: { accessType?: string; stoppedDueToInactivity?: boolean };
		}>;
	} | null;
	const live = (list?.data ?? []).filter((r) => !r.attributes?.stoppedDueToInactivity);
	const ongoing = live.filter((r) => r.attributes?.accessType === "ONGOING");
	const snapshots = live.filter((r) => r.attributes?.accessType === "ONE_TIME_SNAPSHOT");
	if (!ongoing.length && budget.n < budget.max) {
		budget.n++;
		const createRes = await fetch(`${ASC_API}/v1/analyticsReportRequests`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				data: {
					type: "analyticsReportRequests",
					attributes: { accessType: "ONGOING" },
					relationships: { app: { data: { type: "apps", id: cfg.app_id } } },
				},
			}),
		});
		if (createRes.ok) {
			const created = (await createRes.json().catch(() => null)) as {
				data?: { id?: string };
			} | null;
			if (created?.data?.id) ongoing.push({ id: created.data.id });
		} else {
			console.log(
				`ASC analytics: no report request for app ${cfg.app_id} and this key cannot create one (HTTP ${createRes.status}); create it once with an Admin key`,
			);
		}
	}
	return [...snapshots, ...ongoing].map((r) => r.id);
}

/* ---------------------------------- sync ---------------------------------- */

export interface AscSyncResult {
	app_id: string;
	days_synced: number;
	days_skipped: number;
	price_changes: number;
	analytics_days: number;
	/** The shared fetch budget ran out before every day of the window was requested. */
	budget_exhausted: boolean;
	/** Newest day of the gap-free completed run after this sync (null = none yet). */
	synced_through: string | null;
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

/** Lookback for a regular run: Apple restates recent days, so they are re-fetched. */
export const ASC_STEADY_DAYS = 7;

/**
 * Days of sales reports to request. A manual `days` wins. Otherwise: from the sync cursor
 * (never fewer than the steady lookback, so an outage longer than a week is caught up),
 * or the configured backfill on an integration that has never completed a day.
 */
export function ascWindowDays(opts: {
	days?: number;
	syncedThrough: string | null;
	backfillDays?: string;
	today?: string;
}): number {
	const today = opts.today ?? isoDaysAgo(0);
	let wanted: number;
	if (opts.days !== undefined) wanted = opts.days;
	else if (opts.syncedThrough) {
		const behind = Math.round(
			(Date.parse(`${today}T00:00:00Z`) - Date.parse(`${opts.syncedThrough}T00:00:00Z`)) /
				86_400_000,
		);
		wanted = Math.max(ASC_STEADY_DAYS, behind);
	} else wanted = Number.parseInt(opts.backfillDays ?? "30", 10) || 30;
	return Math.max(1, Math.min(wanted, 90));
}

/** A report for today or yesterday may simply not exist yet; older 404s mean Apple has nothing for that day. */
const REPORT_PENDING_DAYS = 2;

/**
 * Whether a sales-report answer settles its day. Complete days let the sync cursor pass;
 * a pending day (not published yet), a rate limit or an Apple 5xx keeps it where it is so
 * the next run asks again. Any other 4xx will not change by retrying, so it must not
 * block every later day forever.
 */
export function ascDayComplete(status: number, daysAgo: number): boolean {
	if (status >= 200 && status < 300) return true;
	if (status === 404) return daysAgo >= REPORT_PENDING_DAYS;
	if (status === 429 || status >= 500) return false;
	return true;
}

/** Apple's only valid version for SALES / SUMMARY / DAILY (1_3 is rejected with HTTP 400). */
const SALES_REPORT_VERSION = "1_1";

/**
 * Store new engagement report instances: impressions and page views per day (on the
 * sales row, without touching its sales figures) and per source. Each report request
 * keeps its own cursor (newest processingDate stored) in the integration config, so a
 * history snapshot that arrives after the daily request still gets read. An instance
 * counts as done only when all its segments were fetched. Returns days stored.
 */
async function syncEngagement(
	db: Kysely<KlikapaDatabase>,
	integration: Pick<IntegrationTable, "id" | "site_id">,
	cfg: AscConfig,
	token: string,
	budget: FetchBudget,
): Promise<number> {
	const cursors: Record<string, string> = { ...cfg.engagement_cursor };
	let stored = 0;
	let changed = false;
	outer: for (const reqId of await engagementRequestIds(cfg, token, budget)) {
		if (budget.n >= budget.max) break;
		const reportsRes = await ascFetch(
			`/v1/analyticsReportRequests/${reqId}/reports?filter[name]=${encodeURIComponent(ENGAGEMENT_REPORT)}`,
			token,
			budget,
		);
		const reports = (await reportsRes.json().catch(() => null)) as {
			data?: Array<{ id: string }>;
		} | null;
		const reportId = reports?.data?.[0]?.id;
		if (!reportId || budget.n >= budget.max) continue;
		const instRes = await ascFetch(
			`/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`,
			token,
			budget,
		);
		const instances = (
			(
				(await instRes.json().catch(() => null)) as {
					data?: Array<{ id: string; attributes?: { processingDate?: string } }>;
				} | null
			)?.data ?? []
		)
			.map((x) => ({ id: x.id, date: x.attributes?.processingDate ?? "" }))
			.filter((x) => x.date && x.date > (cursors[reqId] ?? ""))
			.sort((a, b) => a.date.localeCompare(b.date));

		for (const inst of instances) {
			if (budget.n >= budget.max) break outer;
			const segRes = await ascFetch(
				`/v1/analyticsReportInstances/${inst.id}/segments`,
				token,
				budget,
			);
			const segments = (
				(
					(await segRes.json().catch(() => null)) as {
						data?: Array<{ attributes?: { url?: string } }>;
					} | null
				)?.data ?? []
			).filter((seg) => seg.attributes?.url);
			if (budget.n + segments.length > budget.max) break outer;
			const rows: AscEngagementRow[] = [];
			for (const seg of segments) {
				budget.n++;
				const res = await fetch(seg.attributes!.url!);
				if (!res.ok) continue outer; // retried next run: the cursor stays before this instance
				rows.push(...parseEngagementReport(await readReportText(res), cfg.app_id));
			}
			stored += await upsertEngagement(db, integration.site_id, cfg.app_id, mergeEngagement(rows));
			cursors[reqId] = inst.date;
			changed = true;
		}
	}
	if (changed) await patchConfig(db, integration.id, { engagement_cursor: cursors });
	return stored;
}

/** Merge keys into an integration's stored config (re-read, so concurrent edits survive). */
async function patchConfig(
	db: Kysely<KlikapaDatabase>,
	integrationId: string,
	patch: Record<string, unknown>,
): Promise<void> {
	const row = await db
		.selectFrom("integrations")
		.select("config")
		.where("id", "=", integrationId)
		.executeTakeFirst();
	if (!row) return;
	const fresh = JSON.parse(row.config || "{}") as Record<string, unknown>;
	await db
		.updateTable("integrations")
		.set({ config: JSON.stringify({ ...fresh, ...patch }) })
		.where("id", "=", integrationId)
		.execute();
}

/** Sum rows of the same date and source (an instance may span several segments). */
function mergeEngagement(rows: AscEngagementRow[]): AscEngagementRow[] {
	const out = new Map<string, AscEngagementRow>();
	for (const r of rows) {
		const key = `${r.date}|${r.source}`;
		const m = out.get(key) ?? { date: r.date, source: r.source, impressions: 0, pageViews: 0 };
		m.impressions += r.impressions;
		m.pageViews += r.pageViews;
		out.set(key, m);
	}
	return [...out.values()];
}

async function upsertEngagement(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	appId: string,
	rows: AscEngagementRow[],
): Promise<number> {
	const totals = rows.filter((r) => r.source === "");
	const bySource = rows.filter((r) => r.source !== "");
	const now = new Date().toISOString();
	if (totals.length) {
		await db
			.insertInto("asc_daily_metrics")
			.values(
				totals.map((d) => ({
					id: generateId(),
					site_id: siteId,
					app_id: appId,
					date: d.date,
					units: 0,
					proceeds: 0,
					iap_units: 0,
					iap_proceeds: 0,
					proceeds_currency: null,
					impressions: d.impressions,
					page_views: d.pageViews,
					synced_at: now,
				})),
			)
			// Must not clobber the sales figures already stored for the same day.
			.onConflict((oc) =>
				oc.columns(["site_id", "app_id", "date"]).doUpdateSet((eb) => ({
					impressions: eb.ref("excluded.impressions"),
					page_views: eb.ref("excluded.page_views"),
				})),
			)
			.execute();
	}
	if (bySource.length) {
		await db
			.insertInto("asc_daily_sources")
			.values(
				bySource.map((d) => ({
					id: generateId(),
					site_id: siteId,
					app_id: appId,
					date: d.date,
					source: d.source,
					impressions: d.impressions,
					page_views: d.pageViews,
					synced_at: now,
				})),
			)
			.onConflict((oc) =>
				oc.columns(["site_id", "app_id", "date", "source"]).doUpdateSet((eb) => ({
					impressions: eb.ref("excluded.impressions"),
					page_views: eb.ref("excluded.page_views"),
					synced_at: eb.ref("excluded.synced_at"),
				})),
			)
			.execute();
	}
	return totals.length;
}

/**
 * Sync one appstoreconnect integration: sales reports for the lookback window
 * (see ascWindowDays), price-change annotations from per-unit price diffs, then
 * engagement metrics while subrequest budget remains. Idempotent — every day is
 * upserted. The `synced_through` cursor advances only across a gap-free run of
 * completed days, so days cut off by the shared fetch budget are retried.
 */
export async function syncAppStoreConnect(
	db: Kysely<KlikapaDatabase>,
	integration: Pick<IntegrationTable, "id" | "site_id" | "user_id" | "config" | "last_sync">,
	opts: { days?: number; budget?: FetchBudget } = {},
): Promise<AscSyncResult> {
	const cfg = parseAscConfig(JSON.parse(integration.config || "{}"));
	const budget = opts.budget ?? { n: 0, max: 40 };
	// Read here, not from the caller's row, so every entry point (cron, manual sync) honours the cursor.
	const syncedThrough =
		(
			await db
				.selectFrom("integrations")
				.select("synced_through")
				.where("id", "=", integration.id)
				.executeTakeFirst()
		)?.synced_through ?? null;
	const windowDays = ascWindowDays({
		days: opts.days,
		syncedThrough,
		backfillDays: cfg.backfill_days,
	});
	const token = await signAscToken(cfg);
	const result: AscSyncResult = {
		app_id: cfg.app_id,
		days_synced: 0,
		days_skipped: 0,
		price_changes: 0,
		analytics_days: 0,
		budget_exhausted: false,
		synced_through: syncedThrough,
	};
	const allCountries: AscCountryAgg[] = [];
	let completedThrough: string | null = null;
	let gapFree = true;
	const rates = await loadUsdRates(db);
	// In-app purchase rows name their app by SKU, not Apple ID. Read once, then kept in the config.
	let appSku = cfg.app_sku;
	if (!appSku && budget.n < budget.max) {
		const appRes = await ascFetch(`/v1/apps/${cfg.app_id}?fields[apps]=sku`, token, budget);
		const app = (await appRes.json().catch(() => null)) as {
			data?: { attributes?: { sku?: string } };
		} | null;
		appSku = app?.data?.attributes?.sku;
		if (appSku) await patchConfig(db, integration.id, { app_sku: appSku });
	}

	for (let i = windowDays - 1; i >= 0; i--) {
		const date = isoDaysAgo(i);
		let res: Response;
		try {
			res = await ascFetch(
				`/v1/salesReports?filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[frequency]=DAILY&filter[reportDate]=${date}&filter[version]=${SALES_REPORT_VERSION}&filter[vendorNumber]=${encodeURIComponent(cfg.vendor_number)}`,
				token,
				budget,
			);
		} catch (err) {
			if (err instanceof AscAuthError && err.message === "__budget__") {
				result.budget_exhausted = true;
				break;
			}
			throw err;
		}
		if (!res.ok) {
			if (res.status !== 404) console.log(`ASC sales report ${date}: HTTP ${res.status}`);
			result.days_skipped++;
			if (!ascDayComplete(res.status, i)) gapFree = false;
			if (gapFree) completedThrough = date;
			continue;
		}
		const tsv = await readReportText(res);
		const { days, countries } = aggregateSalesRows(parseSalesReportTsv(tsv), cfg.app_id, {
			appSku,
			rates,
		});
		await upsertDays(db, integration.site_id, cfg.app_id, days);
		await upsertCountries(db, integration.site_id, cfg.app_id, countries);
		allCountries.push(...countries);
		result.days_synced++;
		if (gapFree) completedThrough = date;
	}

	result.price_changes = await recordPriceChangeAnnotations(
		db,
		integration.site_id,
		integration.user_id,
		detectPriceChanges(allCountries),
	);

	// Impressions and page views. Best-effort: Apple generates the first reports a day or
	// two after a report request is created, and they must never fail the sales sync.
	if (budget.n < budget.max) {
		try {
			result.analytics_days = await syncEngagement(db, integration, cfg, token, budget);
		} catch (err) {
			console.log("ASC engagement sync skipped:", err instanceof Error ? err.message : err);
		}
	}

	// A run that fetched nothing (the shared budget went to other integrations first) must not
	// look like a sync. Only fully fetched days move the cursor: a day cut off by the budget,
	// still pending at Apple or failing transiently is fetched again by the next run.
	if (result.days_synced + result.days_skipped === 0) return result;
	const advanced = completedThrough !== null && completedThrough > (syncedThrough ?? "");
	await db
		.updateTable("integrations")
		.set({
			last_sync: new Date().toISOString(),
			...(advanced ? { synced_through: completedThrough } : {}),
		})
		.where("id", "=", integration.id)
		.execute();
	if (advanced) result.synced_through = completedThrough;

	return result;
}

/** Cron entry: sync every enabled appstoreconnect integration; throws after the loop if any failed. */
export async function syncAllAppStoreConnect(db: Kysely<KlikapaDatabase>): Promise<void> {
	const integrations = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "user_id", "config", "last_sync"])
		.where("type", "=", "appstoreconnect")
		.where("enabled", "=", 1)
		// Longest-waiting first (never synced = NULL sorts first): when the shared budget runs
		// out mid-run, the integrations it skipped lead the next run instead of starving.
		.orderBy("last_sync", "asc")
		.execute();
	if (!integrations.length) return;
	// One shared budget per cron invocation — sales reports win over analytics.
	const budget: FetchBudget = { n: 0, max: 45 };
	const failed: string[] = [];
	for (const integration of integrations) {
		try {
			const r = await syncAppStoreConnect(db, integration, { budget });
			console.log(
				`ASC sync site=${integration.site_id}: ${r.days_synced}d synced, ${r.days_skipped}d skipped, ${r.price_changes} price changes, ${r.analytics_days}d engagement${r.budget_exhausted ? " (budget spent, resumes next run)" : ""}`,
			);
		} catch (err) {
			failed.push(integration.site_id);
			console.error(
				`ASC sync failed site=${integration.site_id}:`,
				err instanceof Error ? err.message : err,
			);
		}
	}
	if (failed.length) throw new Error(`ASC sync failed for site(s): ${failed.join(", ")}`);
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

/* --------------------------------- reading --------------------------------- */

export interface AscAppSummary {
	app_id: string;
	/** First-time downloads (paid units for a paid app). */
	downloads: number;
	proceeds_usd: number;
	iap_units: number;
	iap_proceeds_usd: number;
	/** Null until Apple's engagement reports cover the range. */
	impressions: number | null;
	page_views: number | null;
	/** downloads / page_views. */
	page_conversion: number | null;
	by_source: { source: string; impressions: number; page_views: number }[];
	by_country: { country: string; downloads: number; proceeds_usd: number }[];
	daily: {
		date: string;
		downloads: number;
		proceeds_usd: number;
		impressions: number | null;
		page_views: number | null;
	}[];
}

/** Per-app App Store figures stored for a site between two ISO dates (inclusive). */
export async function appStoreSummary(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	from: string,
	to: string,
): Promise<{ from: string; to: string; apps: AscAppSummary[]; last_sync: string | null }> {
	const [days, sources, countries, integrations] = await Promise.all([
		db
			.selectFrom("asc_daily_metrics")
			.selectAll()
			.where("site_id", "=", siteId)
			.where("date", ">=", from)
			.where("date", "<=", to)
			.orderBy("date", "asc")
			.execute(),
		db
			.selectFrom("asc_daily_sources")
			.select([
				"app_id",
				"source",
				(eb) => eb.fn.sum<number>("impressions").as("impressions"),
				(eb) => eb.fn.sum<number>("page_views").as("page_views"),
			])
			.where("site_id", "=", siteId)
			.where("date", ">=", from)
			.where("date", "<=", to)
			.groupBy(["app_id", "source"])
			.execute(),
		db
			.selectFrom("asc_daily_country")
			.select([
				"app_id",
				"country",
				(eb) => eb.fn.sum<number>("units").as("units"),
				(eb) => eb.fn.sum<number>("proceeds").as("proceeds"),
			])
			.where("site_id", "=", siteId)
			.where("date", ">=", from)
			.where("date", "<=", to)
			.groupBy(["app_id", "country"])
			.execute(),
		db
			.selectFrom("integrations")
			.select(["config", "last_sync"])
			.where("site_id", "=", siteId)
			.where("type", "=", "appstoreconnect")
			.execute(),
	]);
	const round = (n: number) => Math.round(n * 100) / 100;
	const appIds = new Set<string>(days.map((d) => d.app_id));
	for (const i of integrations) {
		const id = (JSON.parse(i.config || "{}") as { app_id?: string }).app_id;
		if (id) appIds.add(id);
	}
	const apps = [...appIds].sort().map((appId): AscAppSummary => {
		const mine = days.filter((d) => d.app_id === appId);
		const sum = (pick: (d: (typeof mine)[number]) => number | null) =>
			mine.reduce((a, d) => a + (pick(d) ?? 0), 0);
		const hasEngagement = mine.some((d) => d.impressions !== null || d.page_views !== null);
		const downloads = sum((d) => d.units);
		const pageViews = hasEngagement ? sum((d) => d.page_views) : null;
		return {
			app_id: appId,
			downloads,
			proceeds_usd: round(sum((d) => d.proceeds)),
			iap_units: sum((d) => d.iap_units),
			iap_proceeds_usd: round(sum((d) => d.iap_proceeds)),
			impressions: hasEngagement ? sum((d) => d.impressions) : null,
			page_views: pageViews,
			page_conversion: pageViews ? Math.round((downloads / pageViews) * 10000) / 10000 : null,
			by_source: sources
				.filter((s) => s.app_id === appId)
				.map((s) => ({
					source: s.source,
					impressions: Number(s.impressions),
					page_views: Number(s.page_views),
				}))
				.sort((a, b) => b.impressions - a.impressions),
			by_country: countries
				.filter((c) => c.app_id === appId && Number(c.units) !== 0)
				.map((c) => ({
					country: c.country,
					downloads: Number(c.units),
					proceeds_usd: round(Number(c.proceeds)),
				}))
				.sort((a, b) => b.downloads - a.downloads),
			daily: mine.map((d) => ({
				date: d.date,
				downloads: d.units,
				proceeds_usd: round(d.proceeds),
				impressions: d.impressions,
				page_views: d.page_views,
			})),
		};
	});
	const syncs = integrations.map((i) => i.last_sync).filter(Boolean) as string[];
	return { from, to, apps, last_sync: syncs.sort().at(-1) ?? null };
}

import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import { fetchServiceAccountAccessToken, parseServiceAccountKey } from "./gsc-service-account";

/** Days of history the first sync of an integration pulls (GSC keeps about 16 months). */
export const GSC_BACKFILL_DAYS = 90;
/** GSC data lags about 2 days and keeps settling for a few more, so each run re-reads this many days. */
export const GSC_RESYNC_DAYS = 4;
/** A caught-up integration is synced again only after this long. */
export const GSC_REFRESH_HOURS = 20;
/** Search Analytics calls per cron run, shared by every site (Workers free tier allows 50 subrequests). */
export const GSC_CRON_BUDGET = 30;

const DAY = 86_400_000;
// 9 columns per row; D1 allows 100 bound parameters per statement.
const INSERT_CHUNK = 11;

export interface GscFetchBudget {
	n: number;
	max: number;
}

export interface GscCredentials {
	clientId?: string;
	clientSecret?: string;
}

export interface GscSyncResult {
	site_id: string;
	days_synced: number;
	rows: number;
	synced_through: string | null;
	budget_exhausted: boolean;
}

type GscIntegration = { id: string; site_id: string; config: string | null; synced_through?: string | null };

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: "refresh_token",
		}),
	});
	const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
	if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
	if (!data.access_token) throw new Error("Token refresh failed: no access_token in response");
	return data.access_token;
}

export async function fetchSearchAnalytics(accessToken: string, siteUrl: string, startDate: string, endDate: string) {
	const res = await fetch(
		`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit: 1000 }),
		},
	);
	if (!res.ok) {
		const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
		throw new Error(`GSC API error: ${(typeof err.error === "object" && err.error?.message) || res.status}`);
	}
	return (await res.json()) as {
		rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
	};
}

/** Access token for an integration's config: the service account key, or the OAuth refresh token. */
export async function gscAccessToken(config: Record<string, unknown>, creds: GscCredentials): Promise<string> {
	if (config.auth === "service_account") return fetchServiceAccountAccessToken(parseServiceAccountKey(config));
	if (typeof config.refresh_token !== "string") throw new Error("Missing GSC credentials. Please re-authorize.");
	return refreshAccessToken(config.refresh_token, creds.clientId || "", creds.clientSecret || "");
}

/** Replace one day's rows for a site: one delete, then chunked inserts. */
async function writeDay(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	date: string,
	rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>,
): Promise<void> {
	await db.deleteFrom("search_console_data").where("site_id", "=", siteId).where("date", "=", date).execute();
	const fetchedAt = new Date().toISOString();
	for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
		await db
			.insertInto("search_console_data")
			.values(
				rows.slice(i, i + INSERT_CHUNK).map((row) => ({
					id: generateId(),
					site_id: siteId,
					date,
					query: row.keys[0] || "",
					clicks: row.clicks,
					impressions: row.impressions,
					ctr: row.ctr,
					position: row.position,
					fetched_at: fetchedAt,
				})),
			)
			.execute();
	}
}

/**
 * Sync one GSC integration day by day (one Search Analytics call per day, for date attribution).
 * Range: `days` back from 2 days ago when given (manual sync); otherwise from the `synced_through` cursor minus
 * GSC_RESYNC_DAYS, or GSC_BACKFILL_DAYS back on the first run. The cursor only moves forward and is saved after
 * every day, so a run that spends its budget resumes where it stopped.
 */
export async function syncGscIntegration(
	db: Kysely<KlikapaDatabase>,
	integration: GscIntegration,
	creds: GscCredentials,
	opts: { budget: GscFetchBudget; days?: number; now?: number },
): Promise<GscSyncResult> {
	const now = opts.now ?? Date.now();
	const config = JSON.parse(integration.config || "{}") as Record<string, unknown>;
	const siteUrl = config.google_site_url;
	if (typeof siteUrl !== "string" || !siteUrl) throw new Error("Missing GSC credentials. Please re-authorize.");

	const end = dayMs(isoDay(now - 2 * DAY));
	const cursor = integration.synced_through ?? null;
	let start: number;
	if (opts.days) start = end - (opts.days - 1) * DAY;
	else if (cursor) start = Math.min(end, dayMs(cursor) - (GSC_RESYNC_DAYS - 1) * DAY);
	else start = end - (GSC_BACKFILL_DAYS - 1) * DAY;

	const result: GscSyncResult = {
		site_id: integration.site_id,
		days_synced: 0,
		rows: 0,
		synced_through: cursor,
		budget_exhausted: false,
	};
	if (opts.budget.n >= opts.budget.max) return { ...result, budget_exhausted: true };

	opts.budget.n++; // the token request
	const token = await gscAccessToken(config, creds);

	for (let t = start; t <= end; t += DAY) {
		if (opts.budget.n >= opts.budget.max) {
			result.budget_exhausted = true;
			break;
		}
		opts.budget.n++;
		const date = isoDay(t);
		const data = await fetchSearchAnalytics(token, siteUrl, date, date);
		const rows = data.rows ?? [];
		await writeDay(db, integration.site_id, date, rows);
		result.days_synced++;
		result.rows += rows.length;
		if (!result.synced_through || date > result.synced_through) result.synced_through = date;
		await db
			.updateTable("integrations")
			.set({ last_sync: new Date().toISOString(), synced_through: result.synced_through })
			.where("id", "=", integration.id)
			.execute();
	}
	return result;
}

/**
 * Cron: sync every enabled GSC integration that is behind or due for a refresh, least recently synced first, within
 * one shared budget. A failing site is logged and skipped so the others still sync.
 */
export async function syncAllGsc(
	db: Kysely<KlikapaDatabase>,
	creds: GscCredentials,
	opts: { now?: number; budget?: GscFetchBudget } = {},
): Promise<GscSyncResult[]> {
	const now = opts.now ?? Date.now();
	const budget = opts.budget ?? { n: 0, max: GSC_CRON_BUDGET };
	const target = isoDay(now - 2 * DAY);
	const integrations = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "config", "synced_through", "last_sync"])
		.where("type", "=", "google_search_console")
		.where("enabled", "=", 1)
		.orderBy("last_sync", "asc")
		.execute();
	const due = integrations.filter((i) => {
		if (!i.synced_through || i.synced_through < target) return true;
		return !i.last_sync || now - Date.parse(i.last_sync) >= GSC_REFRESH_HOURS * 3_600_000;
	});
	const results: GscSyncResult[] = [];
	const failed: string[] = [];
	for (const integration of due) {
		if (budget.n >= budget.max) break;
		try {
			const r = await syncGscIntegration(db, integration, creds, { budget, now });
			console.log(
				`GSC sync site=${r.site_id}: ${r.days_synced}d, ${r.rows} rows, through ${r.synced_through}${r.budget_exhausted ? " (budget spent, resumes next run)" : ""}`,
			);
			results.push(r);
		} catch (err) {
			console.error(`GSC sync site=${integration.site_id} failed:`, err);
			failed.push(integration.site_id);
		}
	}
	if (failed.length) throw new Error(`GSC sync failed for site(s): ${failed.join(", ")}`);
	return results;
}

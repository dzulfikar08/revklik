import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import {
	bookPolarOrder,
	isBookablePolarOrder,
	polarReportedNet,
	polarRefundedCents,
} from "./polar";
import type { PolarBooking, PolarOrder } from "./polar";

/** Per-site Polar settings, stored as JSON in payment_providers.config (provider = "polar"). */
export interface PolarConfig {
	/** Signing secret of the site's Polar webhook endpoint. */
	webhook_secret?: string;
	/** Organization Access Token (orders:read) used by the order sync. */
	access_token?: string;
	/** Optional: an organization token already scopes the orders it can read. */
	organization_id?: string;
	last_sync_at?: string;
	/** Empty when the last sync succeeded. */
	last_sync_error?: string;
	last_sync_summary?: string;
}

export interface PolarProvider {
	id: string;
	enabled: boolean;
	config: PolarConfig;
}

export function parsePolarConfig(raw: string | null | undefined): PolarConfig {
	try {
		const parsed: unknown = JSON.parse(raw || "{}");
		return parsed && typeof parsed === "object" ? (parsed as PolarConfig) : {};
	} catch {
		return {};
	}
}

export async function findPolarProvider(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
): Promise<PolarProvider | undefined> {
	const row = await db
		.selectFrom("payment_providers")
		.select(["id", "config", "enabled"])
		.where("site_id", "=", siteId)
		.where("provider", "=", "polar")
		.executeTakeFirst();
	return row
		? { id: row.id, enabled: Number(row.enabled) === 1, config: parsePolarConfig(row.config) }
		: undefined;
}

const POLAR_API = "https://api.polar.sh";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const FETCH_TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
/** Stays below D1's 100 bound-parameter ceiling: three keys per order plus the site. */
const LOOKUP_CHUNK = 25;
const REFUND_STEP_KEY = /~\d+:refund$/;
/**
 * Orders booked per run. Each booking costs about a dozen D1 queries and a Worker
 * invocation is capped at 1000, so a long history is brought in over several runs.
 */
export const MAX_BOOKED_PER_RUN = 50;
export const SCHEDULED_LOOKBACK_DAYS = 14;

export class PolarApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "PolarApiError";
	}
}

interface OrdersPage {
	items: PolarOrder[];
	maxPage: number;
}

async function fetchOrdersPage(
	args: { token: string; organizationId?: string; createdAfter?: string; page: number },
	fetcher: typeof fetch,
): Promise<OrdersPage> {
	const params = new URLSearchParams({
		page: String(args.page),
		limit: String(PAGE_SIZE),
		sorting: "-created_at",
	});
	if (args.organizationId) params.set("organization_id", args.organizationId);
	if (args.createdAfter) params.set("created_after", args.createdAfter);
	let res: Response;
	try {
		res = await fetcher(`${POLAR_API}/v1/orders/?${params}`, {
			headers: { Authorization: `Bearer ${args.token}`, Accept: "application/json" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch {
		throw new PolarApiError(0, "Could not reach Polar. Try again in a minute.");
	}
	if (res.status === 401 || res.status === 403) {
		throw new PolarApiError(
			res.status,
			"Polar rejected the access token. It needs the orders:read scope and must not be expired.",
		);
	}
	if (!res.ok) throw new PolarApiError(res.status, `Polar answered with HTTP ${res.status}.`);
	let body: { items?: PolarOrder[]; pagination?: { max_page?: number } };
	try {
		body = (await res.json()) as typeof body;
	} catch {
		throw new PolarApiError(res.status, "Polar returned a response that is not JSON.");
	}
	return { items: body.items ?? [], maxPage: body.pagination?.max_page ?? 1 };
}

interface BookedState {
	revenue: number | null;
	net_source: string | null;
}

interface PolarRefund {
	amount?: number | null;
	created_at?: string | null;
}

/** The order's succeeded refunds, oldest first; empty when Polar refuses (a token without refunds:read). */
async function fetchRefunds(
	token: string,
	orderId: string,
	fetcher: typeof fetch,
): Promise<PolarRefund[]> {
	const params = new URLSearchParams({
		order_id: orderId,
		succeeded: "true",
		limit: String(PAGE_SIZE),
		sorting: "created_at",
	});
	try {
		const res = await fetcher(`${POLAR_API}/v1/refunds/?${params}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) return [];
		const body = (await res.json()) as { items?: PolarRefund[] };
		return body.items ?? [];
	} catch {
		return [];
	}
}

/**
 * Book an order with each refund on its own day. Polar's refunds carry their own created_at; when
 * they are unavailable or do not add up to the order's refunded amount, the order's modified_at
 * stands in for the refund time.
 */
async function bookWithRefundDates(
	db: Kysely<KlikapaDatabase>,
	order: PolarOrder,
	options: PolarSyncOptions,
	fetcher: typeof fetch,
): Promise<PolarBooking> {
	const refundedCents = polarRefundedCents(order);
	const refunds = refundedCents > 0 ? await fetchRefunds(options.token, order.id, fetcher) : [];
	const total = refunds.reduce((sum, refund) => sum + (refund.amount ?? 0), 0);
	if (refunds.length === 0 || total !== refundedCents) {
		return bookPolarOrder(db, order, options.siteId, options.env);
	}
	let cumulative = 0;
	const bookings: PolarBooking[] = [];
	for (const refund of refunds) {
		cumulative += refund.amount ?? 0;
		bookings.push(
			await bookPolarOrder(
				db,
				{ ...order, refunded_amount: cumulative, refunded_at: refund.created_at },
				options.siteId,
				options.env,
			),
		);
	}
	const created = bookings.find((b) => b.sale && !b.sale.duplicate);
	const added = bookings.findLast((b) => b.refund !== "none");
	return {
		sale: (created ?? bookings[0]).sale,
		refund: added?.refund ?? "none",
		refundEventId: added?.refundEventId ?? null,
	};
}

/** Booked sale and refund rows for these order ids, keyed by external id. */
async function loadBooked(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	orderIds: string[],
): Promise<Map<string, BookedState>> {
	const booked = new Map<string, BookedState>();
	for (let i = 0; i < orderIds.length; i += LOOKUP_CHUNK) {
		const ids = orderIds.slice(i, i + LOOKUP_CHUNK);
		const rows = await db
			.selectFrom("events")
			.select(["external_id", "revenue", "net_source"])
			.where("site_id", "=", siteId)
			.where((eb) =>
				eb.or([
					eb("external_id", "in", [...ids, ...ids.map((id) => `${id}:refund`)]),
					...ids.map((id) => eb("external_id", "like", `${id}~%:refund`)),
				]),
			)
			// Naming is_bot opts out of the bot filter, which hides excluded (test) rows.
			.where("is_bot", "in", [0, 1])
			.execute();
		for (const row of rows) {
			if (!row.external_id) continue;
			// Later refunds of an order are separate rows; the order's refunded total is their sum.
			const key = row.external_id.replace(REFUND_STEP_KEY, ":refund");
			const stepRevenue = key.endsWith(":refund")
				? (booked.get(key)?.revenue ?? 0) + (row.revenue ?? 0)
				: row.revenue;
			booked.set(key, { revenue: stepRevenue, net_source: row.net_source });
		}
	}
	return booked;
}

/** True when booking this order would add or change something. */
function needsBooking(order: PolarOrder, booked: Map<string, BookedState>): boolean {
	const sale = booked.get(order.id);
	if (!sale) return true;
	const cents = order.net_amount ?? order.total_amount ?? 0;
	const feeKnown =
		polarReportedNet(
			cents,
			order.platform_fee_amount,
			order.currency,
			order.platform_fee_currency,
		) !== null;
	if (feeKnown && sale.net_source !== "reported") return true;
	const refundedCents = polarRefundedCents(order);
	if (!(refundedCents > 0)) return false;
	const refund = booked.get(`${order.id}:refund`);
	return !refund || Math.round(-(refund.revenue ?? 0) * 100) < refundedCents;
}

export interface PolarSyncResult {
	/** Orders scanned in Polar's list. */
	scanned: number;
	/** New sales booked. */
	imported: number;
	/** Existing orders updated: a refund added or raised, or Polar's real fee stored. */
	updated: number;
	/** Already booked and unchanged. */
	unchanged: number;
	/** Pending, void or free orders: no money to book. */
	ignored: number;
	/** The booking budget ran out; run the sync again for the rest. */
	more: boolean;
}

export interface PolarSyncOptions {
	siteId: string;
	token: string;
	organizationId?: string;
	/** Only orders created in the last N days; null reads the whole history. */
	lookbackDays: number | null;
	maxBooked?: number;
	env?: { FX_USD_IDR?: string };
	fetcher?: typeof fetch;
}

/**
 * Book the site's recent Polar orders, newest first, with Polar's own fee and any
 * refunds. Orders already booked as they stand cost no writes, so a repeat run is cheap.
 */
export async function syncPolarOrders(
	db: Kysely<KlikapaDatabase>,
	options: PolarSyncOptions,
): Promise<PolarSyncResult> {
	const fetcher = options.fetcher ?? fetch;
	const maxBooked = options.maxBooked ?? MAX_BOOKED_PER_RUN;
	const createdAfter =
		options.lookbackDays === null
			? undefined
			: new Date(Date.now() - options.lookbackDays * DAY_MS).toISOString();
	const result: PolarSyncResult = {
		scanned: 0,
		imported: 0,
		updated: 0,
		unchanged: 0,
		ignored: 0,
		more: false,
	};
	let budget = maxBooked;

	for (let page = 1; page <= MAX_PAGES; page++) {
		const { items, maxPage } = await fetchOrdersPage(
			{
				token: options.token,
				organizationId: options.organizationId,
				createdAfter,
				page,
			},
			fetcher,
		);
		const bookable = items.filter(
			(order) => isBookablePolarOrder(order) && (order.net_amount ?? order.total_amount ?? 0) > 0,
		);
		const booked = await loadBooked(
			db,
			options.siteId,
			bookable.map((order) => order.id),
		);
		result.scanned += items.length;
		result.ignored += items.length - bookable.length;

		for (const order of bookable) {
			if (!needsBooking(order, booked)) {
				result.unchanged++;
				continue;
			}
			if (budget <= 0) {
				result.more = true;
				return result;
			}
			budget--;
			const booking = await bookWithRefundDates(db, order, options, fetcher);
			if (booking.sale && !booking.sale.duplicate) result.imported++;
			else result.updated++;
		}
		if (page >= maxPage) break;
	}
	return result;
}

/** One line for the dashboard: what the last sync did. */
export function summarizeSync(result: PolarSyncResult): string {
	const parts = [
		`${result.imported} new`,
		`${result.updated} updated`,
		`${result.unchanged} unchanged`,
	];
	return `${parts.join(", ")}${result.more ? ", more orders remain" : ""}`;
}

/** Writes the sync outcome into the provider's config without touching the other keys. */
export async function recordSyncState(
	db: Kysely<KlikapaDatabase>,
	providerId: string,
	state: { summary: string; error: string },
): Promise<void> {
	await sql`UPDATE payment_providers
		SET config = json_set(
			CASE WHEN json_valid(config) THEN config ELSE '{}' END,
			'$.last_sync_at', ${new Date().toISOString()},
			'$.last_sync_error', ${state.error},
			'$.last_sync_summary', ${state.summary})
		WHERE id = ${providerId}`.execute(db);
}

/**
 * One scheduled invocation shares D1's per-invocation query cap with the other jobs of the same
 * cron, so the whole Polar pass books at most this many orders and visits this many sites.
 */
export const SCHEDULED_BOOKED_BUDGET = 40;
export const SCHEDULED_MAX_SITES = 15;

export interface PolarSyncAllOptions {
	maxBooked?: number;
	maxSites?: number;
	fetcher?: typeof fetch;
}

/**
 * Sync connected sites that stored an access token, the least recently synced first, so a
 * long list rotates across runs. All sites draw on one booking budget; one site's failure never
 * stops the rest.
 */
export async function syncAllPolar(
	db: Kysely<KlikapaDatabase>,
	env: { FX_USD_IDR?: string },
	options: PolarSyncAllOptions = {},
): Promise<{ sites: number; booked: number }> {
	const rows = await db
		.selectFrom("payment_providers")
		.select(["id", "site_id", "config"])
		.where("provider", "=", "polar")
		.where("enabled", "=", 1)
		.execute();
	const due = rows
		.map((row) => ({ row, config: parsePolarConfig(row.config) }))
		.filter(({ config }) => Boolean(config.access_token))
		.sort((a, b) => (a.config.last_sync_at ?? "").localeCompare(b.config.last_sync_at ?? ""))
		.slice(0, options.maxSites ?? SCHEDULED_MAX_SITES);
	let budget = options.maxBooked ?? SCHEDULED_BOOKED_BUDGET;
	let sites = 0;
	for (const { row, config } of due) {
		if (budget <= 0) break;
		sites++;
		try {
			const result = await syncPolarOrders(db, {
				siteId: row.site_id,
				token: config.access_token ?? "",
				organizationId: config.organization_id,
				lookbackDays: SCHEDULED_LOOKBACK_DAYS,
				maxBooked: budget,
				env,
				fetcher: options.fetcher,
			});
			budget -= result.imported + result.updated;
			await recordSyncState(db, row.id, { summary: summarizeSync(result), error: "" });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Sync failed";
			console.error(`Polar sync failed for site ${row.site_id}:`, message);
			await recordSyncState(db, row.id, { summary: "", error: message });
		}
	}
	return { sites, booked: (options.maxBooked ?? SCHEDULED_BOOKED_BUDGET) - budget };
}

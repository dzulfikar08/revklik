import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { createDb } from "../db";
import { generateId } from "../utils";
import { type ExpoMessage, type ExpoPushEnv, fetchReceipts, sendExpo } from "./expo-push";

/** Everything the push pipeline reads from the Worker bindings. */
export type PushEnv = ExpoPushEnv & { DB: D1Database };

/** A stored revenue event, as the ingest path knows it. */
export interface SaleEventRef {
	id: string;
	siteId: string;
}

interface PushPayload {
	title: string;
	body: string;
	data: {
		type: "sale" | "refund" | "test";
		event_id: string;
		site_id: string;
		url: string;
	};
}

interface TicketRef {
	/** Expo ticket id. */
	t: string;
	/** push_devices.id the ticket was issued for. */
	d: string;
}

export const MAX_PUSH_ATTEMPTS = 5;
const EARNINGS_URL = "revklik://earnings";
const SALES_CHANNEL = "sales";
/** A queued row younger than this is still being sent by the request that created it. */
const QUEUED_GRACE_MS = 2 * 60_000;
/** Expo needs a few minutes before receipts exist; its retention is 24 h. */
const RECEIPT_AFTER_MS = 15 * 60_000;
const RECEIPT_MAX_AGE_MS = 24 * 3_600_000;
const OUTBOX_KEEP_MS = 14 * 24 * 3_600_000;
const FLUSH_BATCH = 100;
const RECEIPT_ROWS = 200;
/** Stays below D1's 100 bound-parameter ceiling. */
const ID_CHUNK = 50;
const NET_EPSILON = 0.005;
const NO_DECIMAL_CURRENCIES = new Set(["IDR"]);

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** "Rp"-less en-US money string in the event's own currency; IDR without decimals. */
export function formatMoney(amount: number, currency: string): string {
	const code = currency.toUpperCase();
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: code,
			...(NO_DECIMAL_CURRENCIES.has(code)
				? { maximumFractionDigits: 0, minimumFractionDigits: 0 }
				: {}),
		}).format(amount);
	} catch {
		return `${amount} ${code}`;
	}
}

interface SaleRow {
	name: string | null;
	product: string | null;
	revenue: number | null;
	net_revenue: number | null;
	currency: string | null;
}

function buildPayload(
	event: SaleEventRef,
	row: SaleRow & { revenue: number },
	site: { name: string; revenue_currency: string },
): PushPayload {
	const isRefund = row.revenue < 0;
	const currency = row.currency || site.revenue_currency || "USD";
	const gross = Math.abs(row.revenue);
	const parts = [row.product || row.name || "Payment", formatMoney(gross, currency)];
	if (row.net_revenue !== null && Math.abs(Math.abs(row.net_revenue) - gross) >= NET_EPSILON) {
		parts.push(`net ${formatMoney(Math.abs(row.net_revenue), currency)}`);
	}
	return {
		title: `${isRefund ? "Refund" : "New sale"} · ${site.name}`,
		body: parts.join(" · "),
		data: {
			type: isRefund ? "refund" : "sale",
			event_id: event.id,
			site_id: event.siteId,
			url: EARNINGS_URL,
		},
	};
}

const toMessage = (to: string, payload: PushPayload): ExpoMessage => ({
	to,
	title: payload.title,
	body: payload.body,
	data: payload.data,
	sound: "default",
	channelId: SALES_CHANNEL,
	priority: "high",
});

/** Queue one outbox row per recipient of this event and send them. Never throws. */
export async function deliverSaleEvent(env: PushEnv, event: SaleEventRef): Promise<void> {
	try {
		const db = createDb(env.DB);
		const row = await db
			.selectFrom("events")
			.innerJoin("sites", "sites.id", "events.site_id")
			.select([
				"events.name as name",
				"events.product as product",
				"events.revenue as revenue",
				"events.net_revenue as net_revenue",
				"events.currency as currency",
				"sites.name as site_name",
				"sites.revenue_currency as site_currency",
			])
			.where("events.id", "=", event.id)
			.where("events.site_id", "=", event.siteId)
			.executeTakeFirst();
		if (!row || row.revenue === null || row.revenue === 0) return;
		const isRefund = row.revenue < 0;

		// Owner and accepted team members that have a phone registered; a missing prefs
		// row means both alerts are on.
		const recipients = await db
			.selectFrom("push_devices")
			.leftJoin("push_prefs", "push_prefs.user_id", "push_devices.user_id")
			.select(["push_devices.user_id as user_id", "push_prefs.sales", "push_prefs.refunds"])
			.distinct()
			.where((eb) =>
				eb.or([
					eb(
						"push_devices.user_id",
						"in",
						eb.selectFrom("sites").select("user_id").where("id", "=", event.siteId),
					),
					eb(
						"push_devices.user_id",
						"in",
						eb
							.selectFrom("team_members")
							.select("user_id")
							.where("site_id", "=", event.siteId)
							.where("accepted_at", "is not", null),
					),
				]),
			)
			.execute();
		const wanted = recipients.filter((r) => (isRefund ? r.refunds : r.sales) !== 0);
		if (wanted.length === 0) return;

		const payload = buildPayload(
			event,
			{ ...row, revenue: row.revenue },
			{ name: row.site_name, revenue_currency: row.site_currency ?? "USD" },
		);
		const now = new Date().toISOString();
		const payloadJson = JSON.stringify(payload);
		const queued: OutboxRow[] = [];
		for (const recipient of wanted) {
			const inserted = await db
				.insertInto("push_outbox")
				.values({
					id: generateId(),
					user_id: recipient.user_id,
					event_id: event.id,
					payload: payloadJson,
					status: "queued",
					attempts: 0,
					tickets_json: null,
					created_at: now,
					sent_at: null,
				})
				.onConflict((oc) => oc.columns(["user_id", "event_id"]).doNothing())
				.returning("id")
				.executeTakeFirst();
			// No row back: this user already has this event (a concurrent delivery won).
			if (inserted) {
				queued.push({
					id: inserted.id,
					user_id: recipient.user_id,
					payload: payloadJson,
					attempts: 0,
					tickets_json: null,
				});
			}
		}
		await sendOutboxRows(db, env, queued);
	} catch (err) {
		console.error("[push] sale alert failed:", err);
	}
}

/**
 * Fire-and-forget entry point for ingest paths: runs the alert after the response via
 * waitUntil. Callers have already stored the event and skip duplicates themselves.
 */
export function notifySaleEvent(
	env: PushEnv,
	ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
	event: SaleEventRef,
): void {
	const job = deliverSaleEvent(env, event);
	if (ctx) ctx.waitUntil(job);
}

/** The request's execution context, or undefined when the app runs without one (tests). */
export function pushCtx(c: Context): Pick<ExecutionContext, "waitUntil"> | undefined {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
}

interface OutboxRow {
	id: string;
	user_id: string;
	payload: string;
	attempts: number;
	tickets_json: string | null;
}

/**
 * One delivery attempt for a set of outbox rows, sent to Expo as one batched call. Each row
 * is claimed first (compare-and-set on `attempts`, so concurrent senders never both send),
 * goes to every device of its user that has no ticket yet, and records what happened.
 * Retryable rows stay `failed` with attempts left.
 */
async function sendOutboxRows(
	db: Kysely<KlikapaDatabase>,
	env: ExpoPushEnv,
	rows: OutboxRow[],
): Promise<void> {
	interface Claimed {
		row: OutboxRow;
		attempts: number;
		tickets: TicketRef[];
		devices: Array<{ id: string; expo_token: string }>;
	}
	const claimedRows: Claimed[] = [];
	for (const row of rows) {
		const claimed = await db
			.updateTable("push_outbox")
			.set({ attempts: row.attempts + 1 })
			.where("id", "=", row.id)
			.where("attempts", "=", row.attempts)
			.where("attempts", "<", MAX_PUSH_ATTEMPTS)
			.where("status", "in", ["queued", "failed"])
			.returning("attempts")
			.executeTakeFirst();
		if (!claimed) continue;
		const tickets: TicketRef[] = row.tickets_json
			? (JSON.parse(row.tickets_json) as TicketRef[])
			: [];
		const delivered = new Set(tickets.map((t) => t.d));
		const devices = (
			await db
				.selectFrom("push_devices")
				.select(["id", "expo_token"])
				.where("user_id", "=", row.user_id)
				.execute()
		).filter((d) => !delivered.has(d.id));
		claimedRows.push({ row, attempts: claimed.attempts, tickets, devices });
	}
	if (claimedRows.length === 0) return;

	const messages = claimedRows.flatMap(({ row, devices }) => {
		const payload = JSON.parse(row.payload) as PushPayload;
		return devices.map((d) => toMessage(d.expo_token, payload));
	});
	const results = await sendExpo(env, messages);

	let offset = 0;
	const dead: string[] = [];
	for (const { row, attempts, tickets, devices } of claimedRows) {
		let retryable = false;
		for (const [index, device] of devices.entries()) {
			const result = results[offset + index];
			if (!result) continue;
			if (result.ok) tickets.push({ t: result.ticketId, d: device.id });
			else if (result.dead) dead.push(device.id);
			else if (result.transient) retryable = true;
		}
		offset += devices.length;

		const finished = !retryable || attempts >= MAX_PUSH_ATTEMPTS;
		const sent = tickets.length > 0;
		await db
			.updateTable("push_outbox")
			.set({
				status: finished && sent ? "sent" : "failed",
				// A finished row with nothing delivered has nothing left to retry.
				attempts: finished && !sent ? MAX_PUSH_ATTEMPTS : attempts,
				tickets_json: sent ? JSON.stringify(tickets) : null,
				...(sent && finished ? { sent_at: new Date().toISOString() } : {}),
			})
			.where("id", "=", row.id)
			.execute();
	}
	await deleteDevices(db, dead);
}

async function deleteDevices(db: Kysely<KlikapaDatabase>, ids: string[]): Promise<void> {
	for (const part of chunks(ids, ID_CHUNK)) {
		await db.deleteFrom("push_devices").where("id", "in", part).execute();
	}
}

/**
 * Cron: resend rows whose first attempt never finished (the Worker died after queueing)
 * or hit a transient Expo error.
 */
export async function flushPushOutbox(env: PushEnv, now = new Date()): Promise<number> {
	const db = createDb(env.DB);
	const staleBefore = new Date(now.getTime() - QUEUED_GRACE_MS).toISOString();
	const rows = await db
		.selectFrom("push_outbox")
		.select(["id", "user_id", "payload", "attempts", "tickets_json"])
		.where((eb) =>
			eb.or([
				eb.and([eb("status", "=", "queued"), eb("created_at", "<=", staleBefore)]),
				eb.and([eb("status", "=", "failed"), eb("attempts", "<", MAX_PUSH_ATTEMPTS)]),
			]),
		)
		.orderBy("created_at", "asc")
		.limit(FLUSH_BATCH)
		.execute();
	await sendOutboxRows(db, env, rows);
	return rows.length;
}

/**
 * Cron: read the Expo receipts of pushes sent 15 minutes to a day ago, delete devices that
 * FCM / APNs refused (DeviceNotRegistered), and drop the ticket ids once settled.
 */
export async function checkPushReceipts(env: PushEnv, now = new Date()): Promise<number> {
	const db = createDb(env.DB);
	const rows = await db
		.selectFrom("push_outbox")
		.select(["id", "tickets_json", "sent_at"])
		.where("status", "=", "sent")
		.where("tickets_json", "is not", null)
		.where("sent_at", "<=", new Date(now.getTime() - RECEIPT_AFTER_MS).toISOString())
		.orderBy("sent_at", "asc")
		.limit(RECEIPT_ROWS)
		.execute();
	if (rows.length === 0) return 0;

	const rowOf = new Map<string, string>();
	const deviceOf = new Map<string, string>();
	const settled = new Set<string>();
	for (const row of rows) {
		const list = JSON.parse(row.tickets_json ?? "[]") as TicketRef[];
		if (row.sent_at && now.getTime() - Date.parse(row.sent_at) > RECEIPT_MAX_AGE_MS) {
			settled.add(row.id);
		}
		for (const ticket of list) {
			rowOf.set(ticket.t, row.id);
			deviceOf.set(ticket.t, ticket.d);
		}
	}
	const receipts = await fetchReceipts(env, [...rowOf.keys()]);
	const dead = [...rowOf.keys()].filter((id) => receipts[id]?.dead).map((id) => deviceOf.get(id));
	await deleteDevices(
		db,
		dead.filter((id): id is string => id !== undefined),
	);
	for (const [ticket, rowId] of rowOf) if (receipts[ticket]) settled.add(rowId);
	for (const ids of chunks([...settled], ID_CHUNK)) {
		await db
			.updateTable("push_outbox")
			.set({ tickets_json: null })
			.where("id", "in", ids)
			.execute();
	}
	return settled.size;
}

/** Closed rows older than two weeks go. Run once a day. */
export async function pruneOutbox(env: PushEnv, now = new Date()): Promise<void> {
	await createDb(env.DB)
		.deleteFrom("push_outbox")
		.where("status", "!=", "queued")
		.where("created_at", "<", new Date(now.getTime() - OUTBOX_KEEP_MS).toISOString())
		.execute();
}

/** Every 5 minutes: retries first, then receipts. A failure in one never skips the other. */
export async function runPushCron(env: PushEnv): Promise<void> {
	await flushPushOutbox(env).catch((err) => console.error("[push] outbox flush failed:", err));
	await checkPushReceipts(env).catch((err) => console.error("[push] receipt check failed:", err));
}

export interface TestPushResult {
	sent: number;
	tickets: Array<{ device_id: string; ok: boolean; ticket_id?: string; error?: string }>;
}

/** Send a test notification to every device of `userId`; dead tokens are deleted on the spot. */
export async function sendTestPush(
	env: PushEnv,
	db: Kysely<KlikapaDatabase>,
	userId: string,
): Promise<TestPushResult> {
	const devices = await db
		.selectFrom("push_devices")
		.select(["id", "expo_token"])
		.where("user_id", "=", userId)
		.execute();
	const results = await sendExpo(
		env,
		devices.map((d) =>
			toMessage(d.expo_token, {
				title: "RevKlik test",
				body: "Sale alerts are working on this phone.",
				data: { type: "test", event_id: "test", site_id: "test", url: EARNINGS_URL },
			}),
		),
	);
	const tickets: TestPushResult["tickets"] = [];
	const dead: string[] = [];
	for (const [index, result] of results.entries()) {
		const device = devices[index];
		if (!device) continue;
		if (result.ok) tickets.push({ device_id: device.id, ok: true, ticket_id: result.ticketId });
		else {
			tickets.push({ device_id: device.id, ok: false, error: result.error });
			if (result.dead) dead.push(device.id);
		}
	}
	await deleteDevices(db, dead);
	return { sent: tickets.filter((t) => t.ok).length, tickets };
}

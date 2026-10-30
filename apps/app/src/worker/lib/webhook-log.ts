import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";

const REJECTED_LOG_INTERVAL_MS = 60_000;

/**
 * Audit row for a delivery that failed authentication. Anyone who knows a site id can send
 * these, so keep one row per site and event type per minute, with the reason and never the body.
 */
export async function logRejectedDelivery(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	integrationId: string,
	eventType: string,
	reason: string,
): Promise<void> {
	const recent = await db
		.selectFrom("webhook_events")
		.select("id")
		.where("site_id", "=", siteId)
		.where("event_type", "=", eventType)
		.where("created_at", ">", new Date(Date.now() - REJECTED_LOG_INTERVAL_MS).toISOString())
		.executeTakeFirst();
	if (recent) return;
	await db
		.insertInto("webhook_events")
		.values({
			id: generateId(),
			site_id: siteId,
			integration_id: integrationId,
			direction: "inbound",
			event_type: eventType,
			payload: JSON.stringify({ reason }),
			status: "failed",
			attempts: 1,
			created_at: new Date().toISOString(),
			processed_at: null,
		})
		.execute();
}

/** Audit row for a delivery: `processed` once booked or deliberately ignored, `failed` when it was not. */
export async function logWebhookEvent(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	integrationId: string,
	eventType: string,
	payload: string,
	status: "processed" | "failed",
): Promise<void> {
	const now = new Date().toISOString();
	await db
		.insertInto("webhook_events")
		.values({
			id: generateId(),
			site_id: siteId,
			integration_id: integrationId,
			direction: "inbound",
			event_type: eventType,
			payload,
			status,
			attempts: 1,
			created_at: now,
			processed_at: status === "processed" ? now : null,
		})
		.execute();
}

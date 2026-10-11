import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import type { PlanTier } from "./plans";

export const TRIAL_PLAN: PlanTier = "growth";
export const TRIAL_DAYS = 7;

/** New signups start a TRIAL_DAYS trial on TRIAL_PLAN, whatever plan they picked. */
export async function startTrial(db: Kysely<KlikapaDatabase>, userId: string): Promise<void> {
	const now = new Date();
	const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
	await db
		.insertInto("subscriptions")
		.values({
			id: generateId(),
			user_id: userId,
			plan: TRIAL_PLAN,
			status: "trialing",
			current_period_start: now.toISOString(),
			current_period_end: trialEnd.toISOString(),
			cancel_at_period_end: 0,
			polar_subscription_id: null,
			polar_customer_id: null,
			created_at: now.toISOString(),
			updated_at: now.toISOString(),
		})
		.onConflict((oc) => oc.column("user_id").doNothing())
		.execute();
}

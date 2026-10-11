import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { generateId } from "../utils";

const REF_CODE_RE = /^[A-Z0-9]{4,32}$/;

/** Link a new signup to the affiliate owning `refCode`. Self-referral is ignored. */
export async function recordReferralSignup(
	db: Kysely<KlikapaDatabase>,
	refCode: unknown,
	userId: string,
): Promise<boolean> {
	if (typeof refCode !== "string") return false;
	const code = refCode.trim().toUpperCase();
	if (!REF_CODE_RE.test(code)) return false;
	const affiliate = await db
		.selectFrom("affiliates")
		.select(["id", "user_id"])
		.where("referral_code", "=", code)
		.where("status", "=", "active")
		.executeTakeFirst();
	if (!affiliate || affiliate.user_id === userId) return false;
	const already = await db
		.selectFrom("referrals")
		.select("id")
		.where("referred_user_id", "=", userId)
		.where("event", "=", "signup")
		.executeTakeFirst();
	if (already) return false;
	await db
		.insertInto("referrals")
		.values({
			id: generateId(),
			affiliate_id: affiliate.id,
			referred_user_id: userId,
			event: "signup",
			commission_amount: 0,
			status: "confirmed",
			created_at: new Date().toISOString(),
		})
		.execute();
	return true;
}

/**
 * Commission for a referred user's payment, in USD. `sourceRef` (provider +
 * payment id) makes it idempotent; no referral, self-referral or a repeat
 * payment id records nothing.
 */
export async function recordReferralCommission(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	sourceRef: string,
	amountUsd: number,
): Promise<boolean> {
	if (!(amountUsd > 0)) return false;
	const link = await db
		.selectFrom("referrals")
		.innerJoin("affiliates", "affiliates.id", "referrals.affiliate_id")
		.select(["affiliates.id", "affiliates.user_id", "affiliates.commission_rate"])
		.where("referrals.referred_user_id", "=", userId)
		.where("referrals.event", "=", "signup")
		.where("affiliates.status", "=", "active")
		.executeTakeFirst();
	if (!link || link.user_id === userId) return false;
	const commission = Math.round(amountUsd * Number(link.commission_rate ?? 0.2) * 100) / 100;
	const inserted = await db
		.insertInto("referrals")
		.values({
			id: generateId(),
			affiliate_id: link.id,
			referred_user_id: userId,
			event: "payment",
			commission_amount: commission,
			status: "pending",
			source_ref: sourceRef,
			created_at: new Date().toISOString(),
		})
		.onConflict((oc) => oc.column("source_ref").doNothing())
		.returning("id")
		.execute();
	if (inserted.length === 0) return false;
	await db
		.updateTable("affiliates")
		.set({ total_earned: sql`total_earned + ${commission}` })
		.where("id", "=", link.id)
		.execute();
	return true;
}

import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type AffiliateEnv = { Variables: Variables };

export const affiliateRoutes = new Hono<AffiliateEnv>();

function generateReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}

async function getOrCreateAffiliate(db: Kysely<KlikapaDatabase>, userId: string) {
  let affiliate = await db
    .selectFrom("affiliates")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!affiliate) {
    const code = generateReferralCode();
    const id = generateId();
    await db
      .insertInto("affiliates")
      .values({
        id,
        user_id: userId,
        referral_code: code,
        commission_rate: 0.2,
        total_earned: 0,
        total_paid: 0,
        status: "active",
        created_at: new Date().toISOString(),
      })
      .execute();
    affiliate = await db
      .selectFrom("affiliates")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  return affiliate;
}

// GET /affiliates/me — Get or create affiliate record
affiliateRoutes.get("/me", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const affiliate = await getOrCreateAffiliate(db, userId);
  return c.json({
    data: {
      id: affiliate!.id,
      referral_code: affiliate!.referral_code,
      commission_rate: affiliate!.commission_rate,
      total_earned: affiliate!.total_earned,
      total_paid: affiliate!.total_paid,
      status: affiliate!.status,
    },
    success: true,
  });
});

// POST /affiliates/generate-code — Generate a new referral code
affiliateRoutes.post("/generate-code", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const affiliate = await getOrCreateAffiliate(db, userId);
  const newCode = generateReferralCode();

  await db
    .updateTable("affiliates")
    .set({ referral_code: newCode })
    .where("id", "=", affiliate!.id)
    .execute();

  return c.json({
    data: { referral_code: newCode },
    success: true,
  });
});

// GET /affiliates/referrals — List all referrals
affiliateRoutes.get("/referrals", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const affiliate = await getOrCreateAffiliate(db, userId);

  const referrals = await db
    .selectFrom("referrals")
    .leftJoin("users", "users.id", "referrals.referred_user_id")
    .select([
      "referrals.id",
      "referrals.referred_user_id",
      "referrals.event",
      "referrals.commission_amount",
      "referrals.status",
      "referrals.created_at",
      "users.name as referred_user_name",
      "users.email as referred_user_email",
    ])
    .where("referrals.affiliate_id", "=", affiliate!.id)
    .orderBy("referrals.created_at", "desc")
    .execute();

  return c.json({
    data: referrals.map((r) => ({
      id: r.id,
      referred_user_id: r.referred_user_id,
      event: r.event,
      commission_amount: r.commission_amount,
      status: r.status,
      created_at: r.created_at,
      referred_user_name: r.referred_user_name,
      referred_user_email: r.referred_user_email,
    })),
    success: true,
  });
});

// GET /affiliates/stats — Aggregate stats
affiliateRoutes.get("/stats", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const affiliate = await getOrCreateAffiliate(db, userId);

  const [totalResult, pendingResult, breakdown] = await Promise.all([
    db
      .selectFrom("referrals")
      .select(({ fn }) => [fn.count<number>("id").as("total_referrals")])
      .where("affiliate_id", "=", affiliate!.id)
      .executeTakeFirst(),
    db
      .selectFrom("referrals")
      .select(({ fn }) => [fn.sum<number>("commission_amount").as("pending_commissions")])
      .where("affiliate_id", "=", affiliate!.id)
      .where("status", "=", "pending")
      .executeTakeFirst(),
    db
      .selectFrom("referrals")
      .select(({ fn }) => [
        "event",
        fn.count<number>("id").as("count"),
        fn.sum<number>("commission_amount").as("total_commission"),
      ])
      .where("affiliate_id", "=", affiliate!.id)
      .groupBy("event")
      .execute(),
  ]);

  return c.json({
    data: {
      total_referrals: Number(totalResult?.total_referrals ?? 0),
      total_earned: affiliate!.total_earned,
      total_paid: affiliate!.total_paid,
      pending_commissions: Number(pendingResult?.pending_commissions ?? 0),
      breakdown: breakdown.map((b) => ({
        event: b.event,
        count: Number(b.count),
        total_commission: Number(b.total_commission ?? 0),
      })),
    },
    success: true,
  });
});

import { Hono } from "hono";
import { createDb } from "../db";
import type { Env } from "../types";
import {
	activatePakasirPayment,
	planForAmount,
	userPrefixFromOrderId,
	verifyWithPakasir,
	PAKASIR_PROJECT,
} from "../lib/pakasir";

// Subset of the Pakasir webhook payload read by this handler.
interface PakasirWebhookBody {
	amount: number;
	order_id: string;
	project: string;
	status: string;
	payment_method?: string | null;
	completed_at?: string | null;
}

export const pakasirWebhookRoutes = new Hono<Env>();

// POST / — Pakasir webhook (no auth — Pakasir calls this).
// The payload has no signature, so when PAKASIR_API_KEY is configured the
// payment is re-verified against the transaction detail API before activation.
pakasirWebhookRoutes.post("/", async (c) => {
	const d1 = c.env.DB;
	if (!d1) return c.json({ error: "DB unavailable" }, 503);
	const db = createDb(d1);

	let body: PakasirWebhookBody;
	try {
		body = await c.req.json<PakasirWebhookBody>();
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const { amount, order_id, project, status, payment_method, completed_at } = body;
	if (project !== PAKASIR_PROJECT) return c.json({ error: "Invalid project" }, 400);
	if (typeof amount !== "number" || typeof order_id !== "string") {
		return c.json({ error: "Invalid payload" }, 400);
	}

	// Pending / expired / failed payments — acknowledge so Pakasir stops retrying.
	if (status !== "completed") {
		return c.json({ success: true, note: "Payment not completed" });
	}

	const userPrefix = userPrefixFromOrderId(order_id);
	if (!userPrefix) return c.json({ error: "Invalid order_id format" }, 400);

	// Fixed-amount payment pages: the amount must match a plan price exactly.
	const plan = planForAmount(amount);
	if (!plan) return c.json({ error: `Unknown amount: ${amount}` }, 400);

	const user = await db
		.selectFrom("users")
		.select(["id"])
		.where("id", "like", `${userPrefix}%`)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found for order" }, 404);

	// Verify against Pakasir when an API key is configured (skipped in dev).
	const apiKey = c.env.PAKASIR_API_KEY || "";
	if (apiKey) {
		const tx = await verifyWithPakasir(apiKey, order_id, amount).catch(() => null);
		if (!tx || tx.status !== "completed" || tx.amount !== amount) {
			return c.json({ error: "Verification failed" }, 401);
		}
	}

	const result = await activatePakasirPayment(db, {
		userId: user.id,
		plan,
		orderId: order_id,
		amount,
		paymentMethod: payment_method,
		completedAt: completed_at,
	});

	return c.json({ success: true, ...result });
});

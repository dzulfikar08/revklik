import { Hono } from "hono";
import { createDb } from "../db";
import { usdRates } from "../lib/fx";
import type { Env } from "../types";
import type { PlanTier } from "../lib/plans";
import {
	activatePakasirPayment,
	findPakasirOrder,
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
// The payload carries no signature, so every completed payment is re-verified
// against the transaction detail API; without PAKASIR_API_KEY nothing activates.
pakasirWebhookRoutes.post("/", async (c) => {
	const d1 = c.env.DB;
	if (!d1) return c.json({ error: "DB unavailable" }, 503);
	const apiKey = c.env.PAKASIR_API_KEY || "";
	if (!apiKey) return c.json({ error: "Pakasir not configured" }, 503);
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

	const order = await findPakasirOrder(db, order_id);
	if (!order) return c.json({ error: "Unknown order" }, 404);
	if (order.status !== "pending") {
		return c.json({ success: true, activated: false, alreadyProcessed: true });
	}
	if (order.amount !== amount) return c.json({ error: "Amount mismatch" }, 400);

	const tx = await verifyWithPakasir(apiKey, order_id, amount).catch(() => null);
	if (!tx || tx.status !== "completed" || tx.amount !== amount) {
		return c.json({ error: "Verification failed" }, 401);
	}

	const result = await activatePakasirPayment(db, {
		userId: order.user_id,
		plan: order.plan as PlanTier,
		orderId: order_id,
		amount,
		paymentMethod: payment_method,
		completedAt: completed_at,
		fxRates: usdRates(c.env),
	});

	return c.json({ success: true, ...result });
});

import { describe, expect, it } from "bun:test";
import type { MigratedTestApp } from "../lib/test-harness";
import {
	booked,
	countedRevenue,
	failEventInsertsOnce,
	quiet,
	SITE,
	setupProvider,
} from "../lib/payments/webhook-test-kit";

const KEY = "Mid-server-live";

async function sha512(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function deliver(t: MigratedTestApp, over: Record<string, unknown> = {}, key = KEY) {
	const n = {
		order_id: "ORD-1",
		status_code: "200",
		gross_amount: "150000.00",
		transaction_status: "settlement",
		payment_type: "qris",
		transaction_time: "2026-10-30 20:15:00",
		custom_field4: SITE,
		...over,
	};
	const signature_key = await sha512(`${n.order_id}${n.status_code}${n.gross_amount}${key}`);
	return t.call("POST", "/api/webhooks/midtrans", { body: { ...n, signature_key } });
}

describe("Midtrans webhook", () => {
	it("books a settlement in IDR with the WIB transaction time read as WIB", async () => {
		const t = await setupProvider("midtrans", { server_key: KEY });
		expect((await deliver(t)).status).toBe(200);
		expect(booked(t)).toMatchObject([
			{
				external_id: "midtrans:ORD-1",
				revenue: 150_000,
				currency: "IDR",
				rail: "midtrans",
				payment_method: "qris",
			},
		]);
		expect(booked(t)[0]?.timestamp).toBe("2026-10-30T13:15:00.000Z");
	});

	it("counts a card's capture and settlement as one sale, and ignores pending/expired", async () => {
		const t = await setupProvider("midtrans", { server_key: KEY });
		await deliver(t, { transaction_status: "pending" });
		await deliver(t, {
			transaction_status: "capture",
			fraud_status: "accept",
			payment_type: "credit_card",
		});
		await deliver(t, { transaction_status: "settlement", payment_type: "credit_card" });
		await deliver(t, { transaction_status: "expire" });
		expect(booked(t)).toHaveLength(1);
	});

	it("does not count a challenged capture, and marks a sandbox key as test", async () => {
		const t = await setupProvider("midtrans", { server_key: "SB-Mid-server-x" });
		await deliver(
			t,
			{ transaction_status: "capture", fraud_status: "challenge" },
			"SB-Mid-server-x",
		);
		expect(booked(t)).toHaveLength(0);
		await deliver(t, {}, "SB-Mid-server-x");
		expect(booked(t)[0]?.excluded_reason).toBe("test");
		expect(countedRevenue(t)).toBe(0);
	});

	it("books partial and full refunds from the running refunded total, once each", async () => {
		const t = await setupProvider("midtrans", { server_key: KEY });
		await deliver(t);
		await deliver(t, { transaction_status: "partial_refund", refund_amount: "50000.00" });
		await deliver(t, { transaction_status: "partial_refund", refund_amount: "50000.00" });
		await deliver(t, { transaction_status: "refund", refund_amount: "150000.00" });
		expect(
			booked(t)
				.filter((r) => r.revenue < 0)
				.map((r) => r.revenue)
				.sort((a, b) => a - b),
		).toEqual([-100_000, -50_000]);
		expect(countedRevenue(t)).toBe(0);
	});

	it("is idempotent on replay and order-independent for a refund before its settlement", async () => {
		const t = await setupProvider("midtrans", { server_key: KEY });
		await deliver(t, { transaction_status: "refund" });
		await deliver(t);
		await deliver(t);
		expect(booked(t)).toHaveLength(2);
		expect(countedRevenue(t)).toBe(0);
	});

	it("fails on a transient error so Midtrans retries, then books once", async () => {
		const t = await setupProvider("midtrans", { server_key: KEY });
		failEventInsertsOnce(t);
		expect((await quiet(() => deliver(t))).status).toBe(500);
		expect((await deliver(t)).status).toBe(200);
		expect(booked(t)).toHaveLength(1);
	});

	it("rejects a bad signature and a missing server key", async () => {
		const t = await setupProvider("midtrans", { server_key: KEY });
		expect((await deliver(t, {}, "wrong-key")).status).toBe(401);
		t.db.exec("UPDATE payment_providers SET config = '{}'");
		expect((await deliver(t)).status).toBe(401);
		expect(booked(t)).toHaveLength(0);
	});
});

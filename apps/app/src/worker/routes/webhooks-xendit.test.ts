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

const TOKEN = "xnd-token";

function deliver(t: MigratedTestApp, body: Record<string, unknown>, token = TOKEN) {
	return t.call("POST", "/api/webhooks/xendit", {
		body,
		headers: { "x-callback-token": token },
	});
}

const invoice = (over: Record<string, unknown> = {}) => ({
	id: "inv-1",
	external_id: "order-1",
	status: "PAID",
	amount: 250_000,
	currency: "IDR",
	payment_method: "BANK_TRANSFER",
	payment_channel: "BCA",
	paid_at: "2026-10-30T10:00:00.000Z",
	metadata: { revklik_site_id: SITE, revklik_visitor_id: "v-xnd" },
	...over,
});

describe("Xendit webhook", () => {
	it("books a paid invoice with its paid_at time and the buyer's visitor", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		expect((await deliver(t, invoice())).status).toBe(200);
		expect(booked(t)).toMatchObject([
			{
				external_id: "xendit:inv-1",
				revenue: 250_000,
				currency: "IDR",
				visitor_id: "v-xnd",
				payment_method: "va_bca",
			},
		]);
		expect(booked(t)[0]?.timestamp).toBe("2026-10-30T10:00:00.000Z");
	});

	it("never counts a pending or expired invoice, whatever the event says", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		await deliver(t, { event: "invoice.paid", data: invoice({ status: "PENDING" }) });
		await deliver(t, { event: "invoice.expired", data: invoice({ status: "EXPIRED" }) });
		expect(booked(t)).toHaveLength(0);
	});

	it("books a recurring cycle as a renewal keyed by the cycle id", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		const cycle = (id: string) => ({
			event: "recurring.cycle.succeeded",
			data: invoice({ id, status: "SUCCEEDED", recurring_payment_id: "plan-1" }),
		});
		await deliver(t, cycle("cyc-1"));
		await deliver(t, cycle("cyc-2"));
		await deliver(t, cycle("cyc-2"));
		expect(booked(t).map((r) => r.external_id)).toEqual(["xendit:cyc-1", "xendit:cyc-2"]);
		const row = t.db
			.query("SELECT subscription_id FROM events WHERE external_id = 'xendit:cyc-1'")
			.get() as { subscription_id: string };
		expect(row.subscription_id).toBe("plan-1");
	});

	it("books each refund under its own id and finds its site from the invoice", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		await deliver(t, invoice());
		const refund = (id: string, amount: number) =>
			deliver(t, {
				event: "refund.succeeded",
				data: { id, invoice_id: "inv-1", status: "SUCCEEDED", amount, currency: "IDR" },
			});
		expect((await refund("rfd-1", 50_000)).status).toBe(200);
		await refund("rfd-1", 50_000);
		await refund("rfd-2", 200_000);
		expect(
			booked(t)
				.filter((r) => r.revenue < 0)
				.map((r) => r.revenue)
				.sort((a, b) => a - b),
		).toEqual([-200_000, -50_000]);
		expect(countedRevenue(t)).toBe(0);
		expect(booked(t).find((r) => r.revenue < 0)?.visitor_id).toBe("v-xnd");
	});

	it("a refund before its sale is booked and the sale then nets it out", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		await deliver(t, {
			event: "refund.succeeded",
			data: {
				id: "rfd-1",
				invoice_id: "inv-1",
				status: "SUCCEEDED",
				amount: 250_000,
				currency: "IDR",
				metadata: { revklik_site_id: SITE },
			},
		});
		await deliver(t, invoice());
		expect(countedRevenue(t)).toBe(0);
	});

	it("a transient failure answers 5xx and the retry books once", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		failEventInsertsOnce(t);
		expect((await quiet(() => deliver(t, invoice()))).status).toBe(500);
		expect((await deliver(t, invoice())).status).toBe(200);
		expect(booked(t)).toHaveLength(1);
	});

	it("rejects a wrong callback token", async () => {
		const t = await setupProvider("xendit", { webhook_secret: TOKEN });
		expect((await deliver(t, invoice(), "nope")).status).toBe(401);
		expect(booked(t)).toHaveLength(0);
	});
});

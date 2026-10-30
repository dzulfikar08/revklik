import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMigratedTestApp, type MigratedTestApp, settleWaitUntil } from "../lib/test-harness";
import { formatMoney, checkPushReceipts, flushPushOutbox } from "../lib/push";

interface ExpoMessageBody {
	to: string;
	title: string;
	body: string;
	data: Record<string, unknown>;
	channelId?: string;
	priority?: string;
	sound?: string;
}

const realFetch = globalThis.fetch;
let sends: Array<{ messages: ExpoMessageBody[]; auth: string | null }> = [];
let receiptRequests: string[][] = [];
/** ticket id -> receipt body returned by the mocked getReceipts. */
let receipts: Record<string, unknown> = {};
let sendMode: "ok" | "server-error" = "ok";
let ticketSeq = 0;

beforeEach(() => {
	sends = [];
	receiptRequests = [];
	receipts = {};
	sendMode = "ok";
	ticketSeq = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url === "https://exp.host/--/api/v2/push/send") {
			const messages = JSON.parse(String(init?.body)) as ExpoMessageBody[];
			const auth = new Headers(init?.headers).get("authorization");
			sends.push({ messages, auth });
			if (sendMode === "server-error") return new Response("down", { status: 503 });
			return Response.json({
				data: messages.map(() => ({ status: "ok", id: `ticket-${++ticketSeq}` })),
			});
		}
		if (url === "https://exp.host/--/api/v2/push/getReceipts") {
			const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
			receiptRequests.push(ids);
			return Response.json({
				data: Object.fromEntries(
					ids.filter((id) => id in receipts).map((id) => [id, receipts[id]]),
				),
			});
		}
		return realFetch(input, init);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

const BROWSER_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const tokenA = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const tokenB = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const tokenC = "ExponentPushToken[cccccccccccccccccccccc]";

async function setup() {
	const t = await createMigratedTestApp({ EXPO_ACCESS_TOKEN: "expo-secret" });
	const owner = await t.seedUser({ id: "u-own", withSite: "s-push" });
	const member = await t.seedUser({ id: "u-mem" });
	const invited = await t.seedUser({ id: "u-inv" });
	const now = new Date().toISOString();
	t.db
		.prepare(
			"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES (?,?,?,?,?,?,?)",
		)
		.run("tm-1", "s-push", "u-mem", "viewer", "u-own", now, now);
	t.db
		.prepare(
			"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES (?,?,?,?,?,?,NULL)",
		)
		.run("tm-2", "s-push", "u-inv", "viewer", "u-own", now);
	// Server-events writer for the site.
	const { generateId, hashToken } = await import("../utils");
	const writer = `rv_${generateId().replaceAll("-", "")}`;
	t.db
		.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run(
			generateId(),
			"u-own",
			await hashToken(writer),
			writer.slice(0, 8),
			"w",
			"site",
			JSON.stringify(["events:write"]),
			"s-push",
		);
	return { t, owner, member, invited, writer };
}

const register = (t: MigratedTestApp, token: string, expoToken: string, platform = "ios") =>
	t.call("POST", "/api/push/devices", { token, body: { expo_token: expoToken, platform } });

const sale = (over: Record<string, unknown> = {}) => ({
	site_id: "s-push",
	name: "purchase",
	revenue: 9.99,
	net_revenue: 7.5,
	currency: "USD",
	external_id: "tx-1",
	source: "app_store",
	props: { product: "pro" },
	...over,
});

const postSale = async (t: MigratedTestApp, writer: string, over: Record<string, unknown> = {}) => {
	const res = await t.call("POST", "/api/v1/events/server", { token: writer, body: sale(over) });
	await settleWaitUntil();
	return res;
};

const deviceCount = (t: MigratedTestApp) =>
	(t.db.query("SELECT COUNT(*) AS n FROM push_devices").get() as { n: number }).n;

describe("push devices", () => {
	it("requires a session", async () => {
		const { t } = await setup();
		const res = await t.call("POST", "/api/push/devices", {
			body: { expo_token: tokenA, platform: "ios" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects tokens that are not Expo push tokens, and unknown platforms", async () => {
		const { t, owner } = await setup();
		expect((await register(t, owner, "fcm-raw-device-token")).status).toBe(400);
		expect((await register(t, owner, "ExponentPushToken[bad token]")).status).toBe(400);
		expect((await register(t, owner, tokenA, "windows")).status).toBe(400);
		expect(deviceCount(t)).toBe(0);
		expect((await register(t, owner, "ExpoPushToken[abc_DEF-123]")).status).toBe(200);
	});

	it("upserts by token and re-assigns it to the account that registered last", async () => {
		const { t, owner, member } = await setup();
		const first = await t.call("POST", "/api/push/devices", {
			token: owner,
			body: { expo_token: tokenA, platform: "ios", locale: "en-US", app_version: "1.0.0" },
		});
		expect((await first.json()) as Record<string, unknown>).toEqual({ success: true });
		await t.call("POST", "/api/push/devices", {
			token: member,
			body: { expo_token: tokenA, platform: "android", app_version: "1.1.0" },
		});
		expect(deviceCount(t)).toBe(1);
		expect(
			t.db.query("SELECT user_id, platform, locale, app_version FROM push_devices").get(),
		).toEqual({ user_id: "u-mem", platform: "android", locale: null, app_version: "1.1.0" });
	});

	it("deletes only the caller's own token", async () => {
		const { t, owner, member } = await setup();
		await register(t, owner, tokenA);
		await t.call("DELETE", "/api/push/devices", { token: member, body: { expo_token: tokenA } });
		expect(deviceCount(t)).toBe(1);
		await t.call("DELETE", "/api/push/devices", { token: owner, body: { expo_token: tokenA } });
		expect(deviceCount(t)).toBe(0);
	});
});

const getPrefs = async (t: MigratedTestApp, token: string) =>
	(await (await t.call("GET", "/api/push/prefs", { token })).json()) as Record<string, unknown>;

describe("push prefs", () => {
	it("defaults to on, saves partial updates, and rejects non-booleans", async () => {
		const { t, owner } = await setup();
		expect(await getPrefs(t, owner)).toEqual({
			sales: true,
			refunds: true,
		});
		const put = await t.call("PUT", "/api/push/prefs", { token: owner, body: { refunds: false } });
		expect((await put.json()) as Record<string, unknown>).toEqual({ sales: true, refunds: false });
		expect(await getPrefs(t, owner)).toEqual({
			sales: true,
			refunds: false,
		});
		expect(
			(await t.call("PUT", "/api/push/prefs", { token: owner, body: { sales: "no" } })).status,
		).toBe(400);
	});
});

describe("POST /api/push/test", () => {
	it("pushes to every device of the caller", async () => {
		const { t, owner, member } = await setup();
		await register(t, owner, tokenA);
		await register(t, owner, tokenB, "android");
		await register(t, member, tokenC);
		const res = await t.call("POST", "/api/push/test", { token: owner });
		const body = (await res.json()) as { sent: number; tickets: unknown[] };
		expect(body.sent).toBe(2);
		expect(body.tickets).toHaveLength(2);
		expect(sends).toHaveLength(1);
		expect(sends[0]?.messages.map((m) => m.to).sort()).toEqual([tokenA, tokenB]);
	});
});

describe("sale alerts", () => {
	it("queues one push per recipient device with the right title, body and data", async () => {
		const { t, owner, member, invited, writer } = await setup();
		await register(t, owner, tokenA);
		await register(t, owner, tokenB, "android");
		await register(t, member, tokenC);
		// Invited but not accepted: no alert even with a phone registered.
		await register(t, invited, "ExponentPushToken[dddddddddddddddddddddd]");

		const res = await postSale(t, writer);
		const { event_id } = (await res.json()) as { event_id: string };

		expect(sends).toHaveLength(1);
		expect(sends[0]?.auth).toBe("Bearer expo-secret");
		const messages = sends[0]?.messages ?? [];
		expect(messages.map((m) => m.to).sort()).toEqual([tokenA, tokenB, tokenC]);
		for (const m of messages) {
			expect(m.title).toBe("New sale · s-push");
			expect(m.body).toBe("pro · $9.99 · net $7.50");
			expect(m.data).toEqual({
				type: "sale",
				event_id,
				site_id: "s-push",
				url: "revklik://earnings",
			});
			expect(m.channelId).toBe("sales");
			expect(m.priority).toBe("high");
			expect(m.sound).toBe("default");
		}
		const rows = t.db
			.query("SELECT user_id, status, attempts FROM push_outbox ORDER BY user_id")
			.all();
		expect(rows).toEqual([
			{ user_id: "u-mem", status: "sent", attempts: 1 },
			{ user_id: "u-own", status: "sent", attempts: 1 },
		]);
	});

	it("does not push a duplicate external_id twice", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		await postSale(t, writer);
		const again = await postSale(t, writer);
		expect(await again.json()).toMatchObject({ duplicate: true });
		expect(sends).toHaveLength(1);
		expect((t.db.query("SELECT COUNT(*) AS n FROM push_outbox").get() as { n: number }).n).toBe(1);
	});

	it("honours the refunds and sales toggles", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		await t.call("PUT", "/api/push/prefs", { token: owner, body: { refunds: false } });

		await postSale(t, writer);
		expect(sends).toHaveLength(1);
		await postSale(t, writer, {
			name: "refund",
			revenue: -9.99,
			net_revenue: -7.5,
			external_id: "tx-1:refund",
		});
		expect(sends).toHaveLength(1);

		await t.call("PUT", "/api/push/prefs", { token: owner, body: { refunds: true, sales: false } });
		await postSale(t, writer, { external_id: "tx-2" });
		expect(sends).toHaveLength(1);
		await postSale(t, writer, {
			name: "refund",
			revenue: -9.99,
			net_revenue: -7.5,
			external_id: "tx-2:refund",
		});
		expect(sends).toHaveLength(2);
		expect(sends[1]?.messages[0]).toMatchObject({
			title: "Refund · s-push",
			body: "pro · $9.99 · net $7.50",
		});
		expect(sends[1]?.messages[0]?.data.type).toBe("refund");
	});

	it("omits net when it equals gross and formats IDR without decimals", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		await postSale(t, writer, {
			revenue: 150000,
			net_revenue: 150000,
			currency: "IDR",
			external_id: "idr-1",
			props: {},
		});
		expect(sends[0]?.messages[0]?.body).toBe("purchase · IDR\u00a0150,000");
	});

	it("never alerts from the public tracker endpoints", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		const batch = await t.call("POST", "/api/track", {
			headers: { "user-agent": BROWSER_UA },
			body: [
				{
					s: "s-push",
					t: "c",
					n: "purchase",
					p: "/checkout",
					sid: "sid-1",
					vid: "vid-1",
					rv: 99,
					ts: Date.now(),
				},
			],
		});
		expect(batch.status).toBe(202);
		const anonymous = await t.call("POST", "/api/track/payment", {
			body: { s: "s-push", amount: 49, transaction_id: "trk-0" },
		});
		expect(anonymous.status).toBe(401);
		const payment = await t.call("POST", "/api/track/payment", {
			token: writer,
			body: { s: "s-push", amount: 49, transaction_id: "trk-1" },
		});
		expect(payment.status).toBe(200);
		await settleWaitUntil();
		expect(
			(t.db.query("SELECT COUNT(*) AS n FROM events WHERE revenue > 0").get() as { n: number }).n,
		).toBe(2);
		expect(sends).toHaveLength(0);
		expect((t.db.query("SELECT COUNT(*) AS n FROM push_outbox").get() as { n: number }).n).toBe(0);
	});

	it("does not push events without revenue or without any device", async () => {
		const { t, owner, writer } = await setup();
		await postSale(t, writer); // nobody has a phone yet
		expect(sends).toHaveLength(0);
		await register(t, owner, tokenA);
		await postSale(t, writer, { revenue: 0, net_revenue: undefined, external_id: "free-1" });
		expect(sends).toHaveLength(0);
	});
});

describe("delivery retries and receipts", () => {
	it("retries a transient failure from the cron without double-sending", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		sendMode = "server-error";
		await postSale(t, writer);
		expect(t.db.query("SELECT status, attempts FROM push_outbox").get()).toEqual({
			status: "failed",
			attempts: 1,
		});

		sendMode = "ok";
		const env = { DB: t.d1 };
		expect(await flushPushOutbox(env)).toBe(1);
		expect(t.db.query("SELECT status, attempts FROM push_outbox").get()).toEqual({
			status: "sent",
			attempts: 2,
		});
		expect(await flushPushOutbox(env)).toBe(0);
		expect(sends.filter((s) => s.messages.length > 0)).toHaveLength(2);
	});

	it("stops retrying after the attempt budget", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		sendMode = "server-error";
		await postSale(t, writer);
		for (let i = 0; i < 10; i++) await flushPushOutbox({ DB: t.d1 });
		expect(t.db.query("SELECT status, attempts FROM push_outbox").get()).toEqual({
			status: "failed",
			attempts: 5,
		});
	});

	it("deletes the device when the receipt says DeviceNotRegistered", async () => {
		const { t, owner, writer } = await setup();
		await register(t, owner, tokenA);
		await register(t, owner, tokenB, "android");
		await postSale(t, writer);
		const tickets = JSON.parse(
			(t.db.query("SELECT tickets_json FROM push_outbox").get() as { tickets_json: string })
				.tickets_json,
		) as Array<{ t: string; d: string }>;
		expect(tickets).toHaveLength(2);
		const deadDevice = t.db
			.query("SELECT id FROM push_devices WHERE expo_token = ?")
			.get(tokenA) as { id: string };
		const deadTicket = tickets.find((x) => x.d === deadDevice.id);
		const okTicket = tickets.find((x) => x.d !== deadDevice.id);
		receipts = {
			[deadTicket?.t ?? ""]: { status: "error", details: { error: "DeviceNotRegistered" } },
			[okTicket?.t ?? ""]: { status: "ok" },
		};

		// Too fresh: Expo has no receipts yet, nothing is read.
		const env = { DB: t.d1 };
		expect(await checkPushReceipts(env)).toBe(0);
		expect(receiptRequests).toHaveLength(0);

		const later = new Date(Date.now() + 20 * 60_000);
		expect(await checkPushReceipts(env, later)).toBe(1);
		expect(t.db.query("SELECT expo_token FROM push_devices").all()).toEqual([
			{ expo_token: tokenB },
		]);
		expect(
			(t.db.query("SELECT tickets_json FROM push_outbox").get() as { tickets_json: string | null })
				.tickets_json,
		).toBeNull();
	});
});

describe("formatMoney", () => {
	it("uses en-US formatting, IDR without decimals, and survives an unknown currency", () => {
		expect(formatMoney(1234.5, "usd")).toBe("$1,234.50");
		expect(formatMoney(150000, "IDR")).toBe("IDR\u00a0150,000");
		expect(formatMoney(1500, "JPY")).toBe("¥1,500");
		expect(formatMoney(5, "not-a-currency")).toBe("5 NOT-A-CURRENCY");
	});
});

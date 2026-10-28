import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { isExpoToken } from "../lib/expo-push";
import { sendTestPush } from "../lib/push";
import type { Env } from "../types";
import { generateId } from "../utils";

export const pushRoutes = new Hono<Env>();

const PLATFORMS = new Set(["ios", "android"]);
const MAX_LOCALE_LENGTH = 35;
const MAX_VERSION_LENGTH = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const optionalText = (value: unknown, max: number): string | null =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

// POST /push/devices — register (or re-assign to the caller) an Expo push token.
pushRoutes.post("/devices", async (c) => {
	const body: unknown = await c.req.json().catch(() => null);
	if (!isRecord(body)) return c.json({ error: "JSON body required", success: false }, 400);
	const { expo_token: token, platform } = body;
	if (typeof token !== "string" || !isExpoToken(token)) {
		return c.json({ error: "expo_token must be an Expo push token", success: false }, 400);
	}
	if (typeof platform !== "string" || !PLATFORMS.has(platform)) {
		return c.json({ error: "platform must be ios or android", success: false }, 400);
	}

	const now = new Date().toISOString();
	const locale = optionalText(body.locale, MAX_LOCALE_LENGTH);
	const appVersion = optionalText(body.app_version, MAX_VERSION_LENGTH);
	await c
		.get("db")
		.insertInto("push_devices")
		.values({
			id: generateId(),
			user_id: c.get("userId"),
			expo_token: token,
			platform,
			locale,
			app_version: appVersion,
			created_at: now,
			last_seen_at: now,
		})
		.onConflict((oc) =>
			oc.column("expo_token").doUpdateSet({
				user_id: c.get("userId"),
				platform,
				locale,
				app_version: appVersion,
				last_seen_at: now,
			}),
		)
		.execute();
	return c.json({ success: true });
});

// DELETE /push/devices — unregister one of the caller's tokens (sign-out).
pushRoutes.delete("/devices", async (c) => {
	const body: unknown = await c.req.json().catch(() => null);
	const token = isRecord(body) ? body.expo_token : undefined;
	if (typeof token !== "string" || !token) {
		return c.json({ error: "expo_token required", success: false }, 400);
	}
	await c
		.get("db")
		.deleteFrom("push_devices")
		.where("expo_token", "=", token)
		.where("user_id", "=", c.get("userId"))
		.execute();
	return c.json({ success: true });
});

interface Prefs {
	sales: boolean;
	refunds: boolean;
}

async function readPrefs(db: Kysely<KlikapaDatabase>, userId: string): Promise<Prefs> {
	const row = await db
		.selectFrom("push_prefs")
		.select(["sales", "refunds"])
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return { sales: row ? row.sales !== 0 : true, refunds: row ? row.refunds !== 0 : true };
}

// GET /push/prefs — both alerts default to on.
pushRoutes.get("/prefs", async (c) => c.json(await readPrefs(c.get("db"), c.get("userId"))));

// PUT /push/prefs — partial update of { sales, refunds }.
pushRoutes.put("/prefs", async (c) => {
	const body: unknown = await c.req.json().catch(() => null);
	if (!isRecord(body)) return c.json({ error: "JSON body required", success: false }, 400);
	for (const key of ["sales", "refunds"] as const) {
		if (body[key] !== undefined && typeof body[key] !== "boolean") {
			return c.json({ error: `${key} must be a boolean`, success: false }, 400);
		}
	}
	const db = c.get("db");
	const userId = c.get("userId");
	const current = await readPrefs(db, userId);
	const next: Prefs = {
		sales: typeof body.sales === "boolean" ? body.sales : current.sales,
		refunds: typeof body.refunds === "boolean" ? body.refunds : current.refunds,
	};
	const values = { sales: next.sales ? 1 : 0, refunds: next.refunds ? 1 : 0 };
	await db
		.insertInto("push_prefs")
		.values({ user_id: userId, ...values, updated_at: new Date().toISOString() })
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({ ...values, updated_at: new Date().toISOString() }),
		)
		.execute();
	return c.json(next);
});

// POST /push/test — a test notification to every device of the caller.
pushRoutes.post("/test", async (c) => {
	const result = await sendTestPush(c.env, c.get("db"), c.get("userId"));
	return c.json(result);
});

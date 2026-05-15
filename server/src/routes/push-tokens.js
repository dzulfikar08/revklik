import { Hono } from "hono";
import { generateId } from "../utils";
export const pushTokenRoutes = new Hono();
// Register device token
pushTokenRoutes.post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { device_token, platform } = await c.req.json();
    if (!device_token || !platform) {
        return c.json({ error: "device_token and platform required", success: false }, 400);
    }
    // Upsert: remove old token if exists, insert new
    await db.deleteFrom("push_tokens").where("device_token", "=", device_token).execute();
    await db.insertInto("push_tokens").values({
        id: generateId(),
        user_id: userId,
        device_token,
        platform,
        created_at: new Date().toISOString(),
    }).execute();
    return c.json({ success: true }, 201);
});
// Unregister device token
pushTokenRoutes.delete("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { device_token } = await c.req.json();
    if (!device_token) {
        return c.json({ error: "device_token required", success: false }, 400);
    }
    await db.deleteFrom("push_tokens")
        .where("device_token", "=", device_token)
        .where("user_id", "=", userId)
        .execute();
    return c.json({ success: true });
});

import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";
import { createDb } from "../db";

export const webhookRoutes = new Hono<{ Variables: { db: Kysely<KlikapaDatabase> } }>();

interface WebhookPayload {
  email?: string;
  event_type?: string;
  timestamp?: string;
  [key: string]: unknown;
}

async function findIntegration(db: Kysely<KlikapaDatabase>, siteId: string, type: string) {
  return db.selectFrom("integrations")
    .select(["id", "site_id", "type", "config"])
    .where("site_id", "=", siteId)
    .where("type", "=", type)
    .where("enabled", "=", 1)
    .executeTakeFirst();
}

async function logWebhookEvent(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  integrationId: string,
  eventType: string,
  payload: string,
  status: string,
) {
  await db.insertInto("webhook_events").values({
    id: generateId(),
    site_id: siteId,
    integration_id: integrationId,
    direction: "inbound",
    event_type: eventType,
    payload,
    status,
    attempts: 1,
    created_at: new Date().toISOString(),
    processed_at: status === "processed" ? new Date().toISOString() : null,
  }).execute();
}

async function processWebhookEvent(db: Kysely<KlikapaDatabase>, siteId: string, email: string, eventType: string) {
  // Look up visitor by email
  const visitor = await db.selectFrom("visitor_profiles")
    .select(["id", "visitor_id"])
    .where("site_id", "=", siteId)
    .where("email", "=", email)
    .executeTakeFirst();

  if (visitor) {
    // Create a custom event linking the external event to the visitor
    const sessionId = generateId();
    // Create a session for this webhook event if we want to track it
    await db.insertInto("sessions").values({
      id: sessionId,
      site_id: siteId,
      visitor_id: visitor.visitor_id,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      entry_path: "/webhook",
      exit_path: "/webhook",
      referrer: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      country: null,
      region: null,
      city: null,
      device_type: "webhook",
      browser: null,
      os: null,
      page_count: 1,
      is_bounce: 0,
      fingerprint: null,
    }).execute();

    await db.insertInto("events").values({
      id: generateId(),
      site_id: siteId,
      session_id: sessionId,
      visitor_id: visitor.visitor_id,
      timestamp: new Date().toISOString(),
      event_type: "custom",
      name: `webhook_${eventType}`,
      path: "/webhook",
      hostname: null,
      referrer: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      country: null,
      region: null,
      city: null,
      device_type: "webhook",
      browser: null,
      os: null,
      revenue: null,
      props: JSON.stringify({ email, source: "webhook" }),
      fingerprint: null,
    }).execute();
  }
}

// POST /mailchimp - Handle Mailchimp webhooks
webhookRoutes.post("/mailchimp", async (c) => {
  const db = c.get("db");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const integration = await findIntegration(db, siteId, "mailchimp");
  if (!integration) return c.json({ error: "No active Mailchimp integration found", success: false }, 404);

  const config = JSON.parse((integration.config as string) || "{}");

  // Validate webhook secret if configured
  const webhookSecret = config.webhook_secret;
  if (webhookSecret) {
    const providedSecret = c.req.header("X-Mailchimp-Signature") || c.req.query("secret");
    if (providedSecret !== webhookSecret) {
      return c.json({ error: "Invalid webhook signature", success: false }, 401);
    }
  }

  const body = await c.req.json<Record<string, unknown>>();
  const payloadStr = JSON.stringify(body);

  try {
    const email = (body.data as Record<string, string>)?.email || (body.email as string) || "";
    const eventType = (body.type as string) || "unknown";

    if (email) {
      await processWebhookEvent(db, siteId, email, `mailchimp_${eventType}`);
    }

    await logWebhookEvent(db, siteId, integration.id, `mailchimp_${eventType}`, payloadStr, "processed");
  } catch (err) {
    await logWebhookEvent(db, siteId, integration.id, "mailchimp_error", payloadStr, "failed");
  }

  return c.json({ success: true });
});

// POST /convertkit - Handle ConvertKit webhooks
webhookRoutes.post("/convertkit", async (c) => {
  const db = c.get("db");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const integration = await findIntegration(db, siteId, "convertkit");
  if (!integration) return c.json({ error: "No active ConvertKit integration found", success: false }, 404);

  const config = JSON.parse((integration.config as string) || "{}");
  const apiKey = config.api_key;

  // Validate via API key in header or query
  const providedKey = c.req.header("X-ConvertKit-Api-Key") || c.req.query("api_key");
  if (apiKey && providedKey !== apiKey) {
    return c.json({ error: "Invalid API key", success: false }, 401);
  }

  const body = await c.req.json<Record<string, unknown>>();
  const payloadStr = JSON.stringify(body);

  try {
    const email = (body.subscriber as Record<string, string>)?.email_address
      || (body.subscriber as Record<string, string>)?.email
      || (body.email as string)
      || "";
    const eventType = (body.event as string) || (body.type as string) || "unknown";

    if (email) {
      await processWebhookEvent(db, siteId, email, `convertkit_${eventType}`);
    }

    await logWebhookEvent(db, siteId, integration.id, `convertkit_${eventType}`, payloadStr, "processed");
  } catch (err) {
    await logWebhookEvent(db, siteId, integration.id, "convertkit_error", payloadStr, "failed");
  }

  return c.json({ success: true });
});

// POST /kit - Handle Kit webhooks (alias for convertkit)
webhookRoutes.post("/kit", async (c) => {
  const db = c.get("db");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const integration = await findIntegration(db, siteId, "kit");
  if (!integration) return c.json({ error: "No active Kit integration found", success: false }, 404);

  const config = JSON.parse((integration.config as string) || "{}");
  const apiKey = config.api_key;

  // Validate via API key or signature
  const providedKey = c.req.header("X-Kit-Api-Key") || c.req.query("api_key");
  if (apiKey && providedKey !== apiKey) {
    return c.json({ error: "Invalid API key", success: false }, 401);
  }

  const body = await c.req.json<Record<string, unknown>>();
  const payloadStr = JSON.stringify(body);

  try {
    const email = (body.subscriber as Record<string, string>)?.email_address
      || (body.subscriber as Record<string, string>)?.email
      || (body.email as string)
      || "";
    const eventType = (body.event as string) || (body.type as string) || "unknown";

    if (email) {
      await processWebhookEvent(db, siteId, email, `kit_${eventType}`);
    }

    await logWebhookEvent(db, siteId, integration.id, `kit_${eventType}`, payloadStr, "processed");
  } catch (err) {
    await logWebhookEvent(db, siteId, integration.id, "kit_error", payloadStr, "failed");
  }

  return c.json({ success: true });
});

// POST /beehiiv - Handle Beehiiv webhooks
webhookRoutes.post("/beehiiv", async (c) => {
  const db = c.get("db");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const integration = await findIntegration(db, siteId, "beehiiv");
  if (!integration) return c.json({ error: "No active Beehiiv integration found", success: false }, 404);

  const config = JSON.parse((integration.config as string) || "{}");
  const secret = config.webhook_secret;

  // Validate webhook signature if configured
  if (secret) {
    const signature = c.req.header("X-Beehiiv-Signature") || c.req.query("secret");
    if (signature !== secret) {
      return c.json({ error: "Invalid webhook signature", success: false }, 401);
    }
  }

  const body = await c.req.json<Record<string, unknown>>();
  const payloadStr = JSON.stringify(body);

  try {
    const email = (body.data as Record<string, string>)?.email
      || (body.email as string)
      || "";
    const eventType = (body.event_type as string) || (body.type as string) || "unknown";

    if (email) {
      await processWebhookEvent(db, siteId, email, `beehiiv_${eventType}`);
    }

    await logWebhookEvent(db, siteId, integration.id, `beehiiv_${eventType}`, payloadStr, "processed");
  } catch (err) {
    await logWebhookEvent(db, siteId, integration.id, "beehiiv_error", payloadStr, "failed");
  }

  return c.json({ success: true });
});

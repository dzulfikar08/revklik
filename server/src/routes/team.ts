import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";
import { sendEmail } from "../lib/email";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
export const teamRoutes = new Hono<{ Variables: Variables }>();

// List team members for a site
teamRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  // Verify user owns the site
  const site = await db.selectFrom("sites").select(["id", "user_id"]).where("id", "=", siteId).executeTakeFirst();
  if (!site) return c.json({ error: "Site not found", success: false }, 404);
  if (site.user_id !== userId) return c.json({ error: "Only site owner can manage team", success: false }, 403);

  const members = await db.selectFrom("team_members")
    .select(["id", "site_id", "user_id", "role", "invited_by", "invited_at", "accepted_at"])
    .where("site_id", "=", siteId)
    .orderBy("invited_at", "asc")
    .execute();

  // Get user details for each member
  const enriched = await Promise.all(members.map(async (m) => {
    const user = await db.selectFrom("users").select(["name", "email"]).where("id", "=", m.user_id).executeTakeFirst();
    return { ...m, name: user?.name ?? null, email: user?.email ?? null };
  }));

  // Include the owner
  const owner = await db.selectFrom("users").select(["id", "name", "email"]).where("id", "=", site.user_id).executeTakeFirst();

  return c.json({
    data: {
      owner: owner ? { ...owner, role: "owner" } : null,
      members: enriched,
    }, success: true,
  });
});

// Invite team member
teamRoutes.post("/invite", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { site_id, email, role } = await c.req.json<{ site_id: string; email: string; role: string }>();

  if (!site_id || !email) return c.json({ error: "site_id and email required", success: false }, 400);
  const validRole = role === "admin" || role === "editor" || role === "viewer" ? role : "viewer";

  const site = await db.selectFrom("sites").select(["id", "user_id", "name"]).where("id", "=", site_id).executeTakeFirst();
  if (!site) return c.json({ error: "Site not found", success: false }, 404);
  if (site.user_id !== userId) return c.json({ error: "Only owner can invite", success: false }, 403);

  // Find user by email
  const invitee = await db.selectFrom("users").select(["id", "name", "email"]).where("email", "=", email).executeTakeFirst();
  if (!invitee) return c.json({ error: "User not found. They must create an account first.", success: false }, 404);

  if (invitee.id === userId) return c.json({ error: "Cannot invite yourself", success: false }, 400);

  // Check if already a member
  const existing = await db.selectFrom("team_members").select(["id"]).where("site_id", "=", site_id).where("user_id", "=", invitee.id).executeTakeFirst();
  if (existing) return c.json({ error: "User already a team member", success: false }, 409);

  const id = generateId();
  await db.insertInto("team_members").values({
    id, site_id, user_id: invitee.id, role: validRole, invited_by: userId,
    invited_at: new Date().toISOString(), accepted_at: new Date().toISOString(),
  }).execute();

  // Send invitation email
  const inviter = await db.selectFrom("users").select(["name"]).where("id", "=", userId).executeTakeFirst();
  const resendKey = (c.env as any).RESEND_API_KEY || "";
  await sendEmail({
    to: email,
    subject: `KlikApa — You've been invited to ${site.name}`,
    html: `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="color: #d4882a; margin: 0 0 12px;">Team Invitation</h2>
      <p style="line-height: 1.6;">${inviter?.name ?? "Someone"} invited you to collaborate on <strong>${site.name}</strong> as <strong>${validRole}</strong>.</p>
      <a href="https://klikapa.app/site" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background: #d4882a; color: #0a0a0a; text-decoration: none; border-radius: 6px; font-weight: 600;">Open Dashboard</a>
    </div>`,
  }, resendKey).catch(() => {});

  return c.json({ data: { id, role: validRole, email }, success: true }, 201);
});

// Update member role
teamRoutes.patch("/:memberId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const memberId = c.req.param("memberId");
  const { role } = await c.req.json<{ role: string }>();

  const validRole = role === "admin" || role === "editor" || role === "viewer" ? role : "viewer";

  const member = await db.selectFrom("team_members").select(["id", "site_id"]).where("id", "=", memberId).executeTakeFirst();
  if (!member) return c.json({ error: "Member not found", success: false }, 404);

  const site = await db.selectFrom("sites").select(["user_id"]).where("id", "=", member.site_id).executeTakeFirst();
  if (!site || site.user_id !== userId) return c.json({ error: "Only owner can update roles", success: false }, 403);

  await db.updateTable("team_members").set({ role: validRole }).where("id", "=", memberId).execute();
  return c.json({ success: true });
});

// Remove team member
teamRoutes.delete("/:memberId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const memberId = c.req.param("memberId");

  const member = await db.selectFrom("team_members").select(["id", "site_id"]).where("id", "=", memberId).executeTakeFirst();
  if (!member) return c.json({ error: "Member not found", success: false }, 404);

  const site = await db.selectFrom("sites").select(["user_id"]).where("id", "=", member.site_id).executeTakeFirst();
  if (!site || site.user_id !== userId) return c.json({ error: "Only owner can remove members", success: false }, 403);

  await db.deleteFrom("team_members").where("id", "=", memberId).execute();
  return c.json({ success: true });
});

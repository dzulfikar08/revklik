import { describe, expect, it } from "bun:test";
import { createMigratedTestApp } from "../lib/test-harness";

const SITE = "s-pp";

async function setup() {
	const t = await createMigratedTestApp();
	const owner = await t.seedUser({ id: "u-owner", withSite: SITE, plan: "starter" });
	const viewer = await t.seedUser({ id: "u-viewer", plan: "starter" });
	const editor = await t.seedUser({ id: "u-editor", plan: "starter" });
	for (const [id, user, role] of [
		["tm-v", "u-viewer", "viewer"],
		["tm-e", "u-editor", "editor"],
	] as const) {
		t.db
			.prepare(
				"INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES (?,?,?,?,'u-owner',datetime('now'))",
			)
			.run(id, SITE, user, role);
	}
	const insert = t.db.prepare(
		"INSERT INTO payment_providers (id, site_id, provider, config, enabled) VALUES (?,?,?,?,1)",
	);
	insert.run("pp-polar", SITE, "polar", JSON.stringify({ webhook_secret: "polar-secret" }));
	insert.run("pp-stripe", SITE, "stripe", JSON.stringify({ webhook_secret: "stripe-secret" }));
	t.db
		.prepare(
			"INSERT INTO webhook_events (id, site_id, integration_id, direction, event_type, payload, status) VALUES ('we-1', ?, 'pp-stripe', 'inbound', 'stripe_x', '{}', 'processed')",
		)
		.run(SITE);
	return { t, owner, viewer, editor };
}

const providers = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
	t.db.query("SELECT provider FROM payment_providers ORDER BY provider").all();

describe("generic payment provider routes", () => {
	it("never deletes Polar: it is managed through /api/polar", async () => {
		const { t, owner } = await setup();
		const res = await t.call("DELETE", `/api/payment-providers/polar?site_id=${SITE}`, {
			token: owner,
		});
		expect(res.status).toBe(400);
		const unknown = await t.call("DELETE", `/api/payment-providers/nope?site_id=${SITE}`, {
			token: owner,
		});
		expect(unknown.status).toBe(400);
		expect(providers(t)).toEqual([{ provider: "polar" }, { provider: "stripe" }]);
	});

	it("keeps viewers from deleting or adding providers", async () => {
		const { t, viewer } = await setup();
		const del = await t.call("DELETE", `/api/payment-providers/stripe?site_id=${SITE}`, {
			token: viewer,
		});
		expect(del.status).toBe(404);
		const add = await t.call("POST", "/api/payment-providers", {
			token: viewer,
			body: { site_id: SITE, provider: "xendit", config: { webhook_secret: "x" } },
		});
		expect(add.status).toBe(404);
		expect(providers(t)).toEqual([{ provider: "polar" }, { provider: "stripe" }]);
		// Reading stays open to viewers, without the Polar row.
		const list = await t.call("GET", `/api/payment-providers?site_id=${SITE}`, { token: viewer });
		expect(list.status).toBe(200);
		expect(((await list.json()) as { data: { provider: string }[] }).data).toHaveLength(1);
	});

	it("lets the owner and an editor delete, and removes the provider's event log", async () => {
		const { t, owner, editor } = await setup();
		const added = await t.call("POST", "/api/payment-providers", {
			token: editor,
			body: { site_id: SITE, provider: "xendit", config: { webhook_secret: "x" } },
		});
		expect(added.status).toBe(201);
		const del = await t.call("DELETE", `/api/payment-providers/stripe?site_id=${SITE}`, {
			token: editor,
		});
		expect(del.status).toBe(200);
		expect(t.db.query("SELECT COUNT(*) AS n FROM webhook_events").get()).toEqual({ n: 0 });
		const gone = await t.call("DELETE", `/api/payment-providers/xendit?site_id=${SITE}`, {
			token: owner,
		});
		expect(gone.status).toBe(200);
		expect(providers(t)).toEqual([{ provider: "polar" }]);
	});
});

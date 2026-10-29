import { afterEach, describe, expect, it } from "bun:test";
import { createMigratedTestApp, settleWaitUntil, type MigratedTestApp } from "../lib/test-harness";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const SELF_SITE = "site-revklik";
const VISITOR = "4f7c2a9e-1b3d-4c5e-8f60-123456789abc";
const SESSION = "0a1b2c3d-4e5f-4a6b-9c7d-0123456789ab";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface SignupRow {
	event_type: string;
	name: string;
	path: string;
	visitor_id: string;
	session_id: string;
	revenue: number | null;
	referrer: string | null;
	source: string | null;
	props: string;
}

async function setup(env: Record<string, unknown> = { REVKLIK_SELF_SITE_ID: SELF_SITE }) {
	const t = await createMigratedTestApp(env);
	await t.seedUser({ id: "u-owner", withSite: SELF_SITE });
	// A tracked landing visit: two sessions for the visitor, the later one is the link target.
	const insert = t.db.prepare(
		"INSERT INTO sessions (id, site_id, visitor_id, started_at, referrer) VALUES (?,?,?,?,?)",
	);
	insert.run("older-session", SELF_SITE, VISITOR, "2026-10-01T00:00:00.000Z", null);
	insert.run(SESSION, SELF_SITE, VISITOR, "2026-10-02T00:00:00.000Z", "https://t.co/abc");
	return t;
}

const signups = (t: MigratedTestApp): SignupRow[] =>
	t.db
		.query(
			"SELECT event_type, name, path, visitor_id, session_id, revenue, referrer, source, props FROM events WHERE name = 'signup' ORDER BY timestamp",
		)
		.all() as SignupRow[];

const register = (t: MigratedTestApp, body: Record<string, unknown>) =>
	t.call("POST", "/api/auth/register", {
		body: { name: "N", password: "password-1", ...body },
	});

async function googleSignIn(t: MigratedTestApp, email: string, query = "") {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		if (String(input).includes("oauth2.googleapis.com/token")) {
			return Response.json({ access_token: "at" });
		}
		return Response.json({ email, sub: `g-${email}`, name: "G", email_verified: true });
	}) as typeof fetch;
	const start = await t.call("GET", `/api/auth/google${query}`);
	const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
	const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
		headers: { cookie },
	});
	expect(cb.status).toBe(302);
	await settleWaitUntil();
}

describe("signup conversion on the revklik.com site", () => {
	it("email register records a revenue-less conversion on the linked visitor's latest session", async () => {
		const t = await setup();
		const res = await register(t, { email: "a@example.com", plan: "starter", rk_vid: VISITOR });
		expect(res.status).toBe(201);
		await settleWaitUntil();

		const [row, ...rest] = signups(t);
		expect(rest).toHaveLength(0);
		expect(row).toMatchObject({
			event_type: "conversion",
			name: "signup",
			path: "/register",
			visitor_id: VISITOR,
			session_id: SESSION,
			referrer: "https://t.co/abc",
		});
		expect(row?.revenue).toBe(0);
		// Inserted through the Kysely path, so the stored traffic source is stamped.
		expect(row?.source).toBeTruthy();
		expect(JSON.parse(row?.props ?? "{}")).toMatchObject({ method: "email", plan: "starter" });
	});

	it("a missing or malformed rk_vid gets a fresh visitor and session", async () => {
		const t = await setup();
		await register(t, { email: "b@example.com" });
		await register(t, { email: "c@example.com", rk_vid: "'; DROP TABLE events;--" });
		await settleWaitUntil();

		const rows = signups(t);
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.visitor_id).toMatch(UUID);
			expect(row.visitor_id).not.toBe(VISITOR);
			expect(row.session_id).toMatch(UUID);
			expect(JSON.parse(row.props).plan).toBeNull();
		}
		expect(new Set(rows.map((r) => r.visitor_id)).size).toBe(2);
	});

	it("an rk_vid with no tracked session keeps the visitor under a new session", async () => {
		const t = await setup();
		const unseen = "11111111-2222-4333-8444-555555555555";
		await register(t, { email: "d@example.com", rk_vid: unseen });
		await settleWaitUntil();
		const [row] = signups(t);
		expect(row?.visitor_id).toBe(unseen);
		expect(row?.session_id).not.toBe(SESSION);
		expect(row?.session_id).toMatch(UUID);
	});

	it("a new Google user is recorded with the rk_vid carried through the OAuth state", async () => {
		const t = await setup();
		await googleSignIn(t, "new.g@example.com", `?plan=growth&rk_vid=${VISITOR}`);
		const [row, ...rest] = signups(t);
		expect(rest).toHaveLength(0);
		expect(row).toMatchObject({ visitor_id: VISITOR, session_id: SESSION });
		expect(JSON.parse(row?.props ?? "{}")).toMatchObject({ method: "google", plan: "growth" });
	});

	it("does not record repeat logins, taken emails or a Google sign-in to an existing account", async () => {
		const t = await setup();
		await register(t, { email: "e@example.com", rk_vid: VISITOR });
		await settleWaitUntil();
		expect(signups(t)).toHaveLength(1);

		const login = await t.call("POST", "/api/auth/login", {
			body: { email: "e@example.com", password: "password-1" },
		});
		expect(login.status).toBe(200);
		const taken = await register(t, { email: "e@example.com", rk_vid: VISITOR });
		expect(taken.status).toBe(409);
		await googleSignIn(t, "e@example.com", `?rk_vid=${VISITOR}`);

		await googleSignIn(t, "f@example.com", `?rk_vid=${VISITOR}`);
		expect(signups(t)).toHaveLength(2);
		await googleSignIn(t, "f@example.com", `?rk_vid=${VISITOR}`);
		await settleWaitUntil();
		expect(signups(t)).toHaveLength(2);
	});

	it("records nothing and still registers when REVKLIK_SELF_SITE_ID is unset", async () => {
		const t = await setup({});
		const res = await register(t, { email: "g@example.com", rk_vid: VISITOR });
		expect(res.status).toBe(201);
		await googleSignIn(t, "h@example.com", `?rk_vid=${VISITOR}`);
		await settleWaitUntil();
		expect(signups(t)).toHaveLength(0);
	});

	it("records nothing when the configured site does not exist", async () => {
		const t = await setup({ REVKLIK_SELF_SITE_ID: "no-such-site" });
		const res = await register(t, { email: "i@example.com", rk_vid: VISITOR });
		expect(res.status).toBe(201);
		await settleWaitUntil();
		expect(signups(t)).toHaveLength(0);
	});

	it("a failing event insert never fails the registration", async () => {
		const t = await setup();
		t.db.exec("DROP TABLE visitor_profiles");
		const res = await register(t, { email: "j@example.com", rk_vid: VISITOR });
		expect(res.status).toBe(201);
		await settleWaitUntil();
	});
});

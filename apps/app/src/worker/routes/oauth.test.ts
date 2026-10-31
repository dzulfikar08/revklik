import { beforeAll, describe, expect, it } from "bun:test";
import { BOOKS_CLIENT_ID, s256Challenge } from "../lib/oauth-provider";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { hashToken } from "../utils";

const SECRET = "test-books-secret-0123456789";
const CALLBACK = "https://books.test/auth/revklik/callback";
const DEV_CALLBACK = "http://localhost:8787/auth/revklik/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const STATE = "state-from-books";

let t: MigratedTestApp;
let verifiedToken: string;
let challenge: string;

const authorizeQuery = (overrides: Record<string, string | null> = {}): string => {
	const params: Record<string, string | null> = {
		response_type: "code",
		client_id: BOOKS_CLIENT_ID,
		redirect_uri: CALLBACK,
		state: STATE,
		code_challenge: challenge,
		code_challenge_method: "S256",
		...overrides,
	};
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value !== null) query.set(key, value);
	return `?${query}`;
};

const getAuthorize = (
	overrides?: Record<string, string | null>,
	headers?: Record<string, string>,
) => t.call("GET", `/oauth/authorize${authorizeQuery(overrides)}`, headers ? { headers } : {});

/** The signed-in user approves; returns the redirect the bridge page would follow. */
async function approve(
	token: string,
	overrides?: Record<string, string | null>,
): Promise<{ status: number; redirectTo: URL | null }> {
	const res = await t.call("POST", "/api/oauth/authorize", {
		token,
		body: { query: authorizeQuery(overrides) },
	});
	const body: { redirect_to?: string } = await res.json();
	return { status: res.status, redirectTo: body.redirect_to ? new URL(body.redirect_to) : null };
}

async function issueCode(token = verifiedToken): Promise<string> {
	const { redirectTo } = await approve(token);
	const code = redirectTo?.searchParams.get("code");
	if (!code) throw new Error("no code issued");
	return code;
}

const exchange = (
	code: string,
	overrides: Record<string, string | null> = {},
	headers: Record<string, string> = {},
) => {
	const form: Record<string, string | null> = {
		grant_type: "authorization_code",
		code,
		redirect_uri: CALLBACK,
		client_id: BOOKS_CLIENT_ID,
		client_secret: SECRET,
		code_verifier: VERIFIER,
		...overrides,
	};
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(form)) if (value !== null) body.set(key, value);
	return t.call("POST", "/oauth/token", {
		body: body.toString(),
		headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
	});
};

const errorOf = async (res: Response): Promise<string> => {
	const body: { error: string } = await res.json();
	return body.error;
};

beforeAll(async () => {
	t = await createMigratedTestApp({
		BOOKS_OAUTH_CLIENT_SECRET: SECRET,
		BOOKS_OAUTH_REDIRECT_URIS: ` ${CALLBACK} , ${DEV_CALLBACK}`,
	});
	challenge = await s256Challenge(VERIFIER);
	verifiedToken = await t.seedUser({ id: "u-verified", email: "Ada@Example.com" });
	t.db
		.prepare(
			"UPDATE users SET name = 'Ada Lovelace', email_verified_at = ? WHERE id = 'u-verified'",
		)
		.run(new Date().toISOString());
});

describe("PKCE helper", () => {
	it("matches the RFC 7636 appendix B vector", async () => {
		expect(await s256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});
});

describe("GET /oauth/authorize", () => {
	it("serves the sign-in bridge for a valid request, locked down", async () => {
		const res = await getAuthorize();
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("referrer-policy")).toBe("no-referrer");
		const csp = res.headers.get("content-security-policy") ?? "";
		const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
		expect(nonce).toBeTruthy();
		const html = await res.text();
		expect(html).toContain(`<script nonce="${nonce}">`);
		// No session: the page returns here through /login?next=…
		expect(html).toContain('"/login?next="');
		expect(html).toContain("/api/oauth/authorize");
		// Nothing from the query string is echoed into the page.
		expect(html).not.toContain(STATE);
	});

	it("answers in Bahasa when the browser asks for it", async () => {
		const html = await (
			await getAuthorize(undefined, { "accept-language": "id-ID,id;q=0.9" })
		).text();
		expect(html).toContain('<html lang="id">');
		expect(html).toContain("Menghubungkan ke RevKlik Books");
	});

	it("shows an error page, never a redirect, for an unknown client", async () => {
		for (const client_id of ["someone-else", "", null]) {
			const res = await getAuthorize({ client_id });
			expect(res.status).toBe(400);
			expect(res.headers.get("location")).toBeNull();
			expect(await res.text()).toContain("Unknown application");
		}
	});

	it("shows an error page, never a redirect, for a redirect_uri that is not an exact match", async () => {
		for (const redirect_uri of [
			"https://evil.test/auth/revklik/callback",
			`${CALLBACK}/`,
			`${CALLBACK}?x=1`,
			"https://books.test/auth/revklik/callback#frag",
			"http://books.test/auth/revklik/callback",
			"",
			null,
		]) {
			const res = await getAuthorize({ redirect_uri });
			expect(res.status).toBe(400);
			expect(res.headers.get("location")).toBeNull();
			expect(await res.text()).toContain("Return address not allowed");
		}
	});

	it("refuses a repeated client_id or redirect_uri", async () => {
		const repeatedClient = await t.call(
			"GET",
			`/oauth/authorize${authorizeQuery()}&client_id=other`,
		);
		expect(repeatedClient.status).toBe(400);
		const repeatedRedirect = await t.call(
			"GET",
			`/oauth/authorize${authorizeQuery()}&redirect_uri=${encodeURIComponent("https://evil.test/")}`,
		);
		expect(repeatedRedirect.status).toBe(400);
		expect(repeatedRedirect.headers.get("location")).toBeNull();
	});

	it("reports other problems to the validated redirect_uri (RFC 6749 4.1.2.1)", async () => {
		const bad = async (overrides: Record<string, string | null>) => {
			const res = await getAuthorize(overrides);
			expect(res.status).toBe(302);
			return new URL(res.headers.get("location") ?? "");
		};
		const noState = await bad({ state: null });
		expect(noState.origin + noState.pathname).toBe(CALLBACK);
		expect(noState.searchParams.get("error")).toBe("invalid_request");
		expect(noState.searchParams.has("state")).toBe(false);

		const implicit = await bad({ response_type: "token" });
		expect(implicit.searchParams.get("error")).toBe("unsupported_response_type");
		expect(implicit.searchParams.get("state")).toBe(STATE);

		const badRequests: Record<string, string | null>[] = [
			{ code_challenge_method: "plain" },
			{ code_challenge_method: null },
			{ code_challenge: null },
			{ code_challenge: "short" },
			{ state: "x".repeat(513) },
		];
		for (const overrides of badRequests) {
			const url = await bad(overrides);
			expect(url.searchParams.get("error")).toBe("invalid_request");
		}
	});

	it("accepts the dev redirect_uri when the operator registered it", async () => {
		expect((await getAuthorize({ redirect_uri: DEV_CALLBACK })).status).toBe(200);
	});

	it("is off until the client secret is configured", async () => {
		const off = await createMigratedTestApp({ BOOKS_OAUTH_REDIRECT_URIS: CALLBACK });
		const res = await off.call("GET", `/oauth/authorize${authorizeQuery()}`);
		expect(res.status).toBe(400);
		expect(res.headers.get("location")).toBeNull();
	});

	it("is rate limited", async () => {
		const limited = await createMigratedTestApp({
			BOOKS_OAUTH_CLIENT_SECRET: SECRET,
			BOOKS_OAUTH_REDIRECT_URIS: CALLBACK,
			RL_API_120: { limit: async () => ({ success: false }) },
		});
		const res = await limited.call("GET", `/oauth/authorize${authorizeQuery()}`);
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("60");
	});
});

describe("POST /api/oauth/authorize", () => {
	it("needs a dashboard session", async () => {
		const res = await t.call("POST", "/api/oauth/authorize", {
			body: { query: authorizeQuery() },
		});
		expect(res.status).toBe(401);
	});

	it("redirects to the registered URI with a code and the caller's state", async () => {
		const { status, redirectTo } = await approve(verifiedToken);
		expect(status).toBe(200);
		expect(`${redirectTo?.origin}${redirectTo?.pathname}`).toBe(CALLBACK);
		expect(redirectTo?.searchParams.get("state")).toBe(STATE);
		const code = redirectTo?.searchParams.get("code") ?? "";
		expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// Only the hash is stored, bound to the client, redirect URI, challenge and user.
		const rows = t.db
			.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?")
			.all(await hashToken(code));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			client_id: BOOKS_CLIENT_ID,
			redirect_uri: CALLBACK,
			code_challenge: challenge,
			user_id: "u-verified",
		});
		expect(t.db.prepare("SELECT 1 FROM oauth_codes WHERE code_hash = ?").get(code)).toBeNull();
	});

	it("re-checks the request: bad client and redirect are errors, not redirects", async () => {
		const client = await t.call("POST", "/api/oauth/authorize", {
			token: verifiedToken,
			body: { query: authorizeQuery({ client_id: "other" }) },
		});
		expect(client.status).toBe(400);
		const redirect = await t.call("POST", "/api/oauth/authorize", {
			token: verifiedToken,
			body: { query: authorizeQuery({ redirect_uri: "https://evil.test/cb" }) },
		});
		expect(redirect.status).toBe(400);
		expect(await redirect.json()).toMatchObject({ error: "invalid_redirect_uri" });
		const missing = await t.call("POST", "/api/oauth/authorize", {
			token: verifiedToken,
			body: {},
		});
		expect(missing.status).toBe(400);
	});

	it("hands back an error redirect for a request problem without issuing a code", async () => {
		const before = (t.db.prepare("SELECT count(*) AS n FROM oauth_codes").get() as { n: number }).n;
		const { status, redirectTo } = await approve(verifiedToken, { code_challenge_method: "plain" });
		expect(status).toBe(200);
		expect(redirectTo?.searchParams.get("error")).toBe("invalid_request");
		expect(redirectTo?.searchParams.has("code")).toBe(false);
		const after = (t.db.prepare("SELECT count(*) AS n FROM oauth_codes").get() as { n: number }).n;
		expect(after).toBe(before);
	});

	it("drops codes that expired long ago when it issues a new one", async () => {
		t.db
			.prepare(
				"INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, user_id, expires_at) VALUES ('stale', 'c', 'r', 'x', 'u', '2020-01-01T00:00:00.000Z')",
			)
			.run();
		await issueCode();
		expect(t.db.prepare("SELECT 1 FROM oauth_codes WHERE code_hash = 'stale'").get()).toBeNull();
	});
});

describe("POST /oauth/token", () => {
	it("returns the signed-in user's identity, uncached", async () => {
		const res = await exchange(await issueCode());
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const identity: Record<string, unknown> = await res.json();
		expect(identity).toEqual({
			sub: "u-verified",
			email: "Ada@Example.com",
			email_verified: true,
			name: "Ada Lovelace",
		});
	});

	it("reports an unverified address as email_verified=false and issues no tokens", async () => {
		const token = await t.seedUser({ id: "u-unverified" });
		const res = await exchange(await issueCode(token));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.email_verified).toBe(false);
		expect(Object.keys(body).sort()).toEqual(["email", "email_verified", "name", "sub"]);
	});

	it("accepts a code once: a replay is invalid_grant", async () => {
		const code = await issueCode();
		expect((await exchange(code)).status).toBe(200);
		const replay = await exchange(code);
		expect(replay.status).toBe(400);
		expect(await errorOf(replay)).toBe("invalid_grant");
	});

	it("races resolve to one winner", async () => {
		const code = await issueCode();
		const results = await Promise.all([exchange(code), exchange(code), exchange(code)]);
		expect(results.filter((res) => res.status === 200)).toHaveLength(1);
	});

	it("refuses an expired code", async () => {
		const code = await issueCode();
		t.db
			.prepare("UPDATE oauth_codes SET expires_at = ? WHERE code_hash = ?")
			.run(new Date(Date.now() - 1000).toISOString(), await hashToken(code));
		const res = await exchange(code);
		expect(res.status).toBe(400);
		expect(await errorOf(res)).toBe("invalid_grant");
	});

	it("gives a code a 60 second life", async () => {
		const code = await issueCode();
		const row = t.db
			.prepare("SELECT expires_at FROM oauth_codes WHERE code_hash = ?")
			.get(await hashToken(code)) as { expires_at: string };
		const ttl = new Date(row.expires_at).getTime() - Date.now();
		expect(ttl).toBeGreaterThan(55_000);
		expect(ttl).toBeLessThanOrEqual(60_000);
	});

	it("refuses a PKCE mismatch, and the failed attempt burns the code", async () => {
		const code = await issueCode();
		const wrong = await exchange(code, { code_verifier: "A".repeat(43) });
		expect(wrong.status).toBe(400);
		expect(await errorOf(wrong)).toBe("invalid_grant");
		expect(await errorOf(await exchange(code))).toBe("invalid_grant");
	});

	it("refuses a redirect_uri other than the one the code was issued for", async () => {
		const code = await issueCode();
		const res = await exchange(code, { redirect_uri: DEV_CALLBACK });
		expect(res.status).toBe(400);
		expect(await errorOf(res)).toBe("invalid_grant");
	});

	it("refuses a wrong client secret without touching the code", async () => {
		const code = await issueCode();
		for (const client_secret of ["wrong", `${SECRET}x`, SECRET.slice(1)]) {
			const res = await exchange(code, { client_secret });
			expect(res.status).toBe(400);
			expect(await errorOf(res)).toBe("invalid_client");
		}
		expect((await exchange(code, { client_id: "other" })).status).toBe(400);
		// The right credentials still redeem it.
		expect((await exchange(code)).status).toBe(200);
	});

	it("refuses every request when no secret is configured", async () => {
		const off = await createMigratedTestApp({ BOOKS_OAUTH_REDIRECT_URIS: CALLBACK });
		const res = await off.call("POST", "/oauth/token", {
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: "x",
				redirect_uri: CALLBACK,
				client_id: BOOKS_CLIENT_ID,
				client_secret: "",
				code_verifier: VERIFIER,
			}).toString(),
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});
		expect(res.status).toBe(400);
	});

	it("refuses an unknown code", async () => {
		const res = await exchange("A".repeat(43));
		expect(res.status).toBe(400);
		expect(await errorOf(res)).toBe("invalid_grant");
	});

	it("is invalid_request when a field is missing, repeated or the grant type is wrong", async () => {
		const code = await issueCode();
		const badForms: Record<string, string | null>[] = [
			{ code: null },
			{ client_secret: null },
			{ code_verifier: null },
			{ redirect_uri: null },
			{ code_verifier: "short" },
			{ grant_type: "client_credentials" },
		];
		for (const overrides of badForms) {
			const res = await exchange(code, overrides);
			expect(res.status).toBe(400);
			expect(await errorOf(res)).toBe("invalid_request");
		}
		const repeated = await t.call("POST", "/oauth/token", {
			body: `grant_type=authorization_code&code=${code}&code=${code}&redirect_uri=${encodeURIComponent(CALLBACK)}&client_id=${BOOKS_CLIENT_ID}&client_secret=${SECRET}&code_verifier=${VERIFIER}`,
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});
		expect(await errorOf(repeated)).toBe("invalid_request");
		// None of that burned the code.
		expect((await exchange(code)).status).toBe(200);
	});

	it("only reads application/x-www-form-urlencoded", async () => {
		const res = await t.call("POST", "/oauth/token", {
			body: { grant_type: "authorization_code" },
		});
		expect(res.status).toBe(400);
		expect(await errorOf(res)).toBe("invalid_request");
		expect(res.headers.get("cache-control")).toBe("no-store");
	});

	it("is invalid_grant when the account is gone", async () => {
		const token = await t.seedUser({ id: "u-gone" });
		const code = await issueCode(token);
		t.db.prepare("DELETE FROM users WHERE id = 'u-gone'").run();
		expect(await errorOf(await exchange(code))).toBe("invalid_grant");
	});

	it("is rate limited", async () => {
		const limited = await createMigratedTestApp({
			BOOKS_OAUTH_CLIENT_SECRET: SECRET,
			BOOKS_OAUTH_REDIRECT_URIS: CALLBACK,
			RL_API_120: { limit: async () => ({ success: false }) },
		});
		const res = await limited.call("POST", "/oauth/token", {
			body: "grant_type=authorization_code",
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("60");
		expect(res.headers.get("cache-control")).toBe("no-store");
	});

	it("does not answer cross-origin requests", async () => {
		const res = await exchange(await issueCode(), {}, { origin: "https://evil.test" });
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});

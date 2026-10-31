import { Hono } from "hono";
import type { Context } from "hono";
import {
	checkAuthorizeRequest,
	exchangeAuthorizationCode,
	issueAuthorizationCode,
	successRedirect,
} from "../lib/oauth-provider";
import { allowRequest } from "../lib/rate-limit";
import { resolveEmailLang } from "../lib/verification-email";
import type { EmailLang } from "../lib/verification-email";
import type { Env } from "../types";

/**
 * Provider side of single sign-on to RevKlik Books (lib/oauth-provider.ts).
 *
 * `oauthRoutes` answer on the public /oauth/* paths and need no session.
 * `oauthSessionRoutes` sit under /api/oauth behind the dashboard's Bearer auth:
 * the sign-in is a localStorage token, which a browser navigation to
 * /oauth/authorize cannot send, so that page hands over to a small script that
 * calls POST /api/oauth/authorize with it.
 */
export const oauthRoutes = new Hono<Env>();
export const oauthSessionRoutes = new Hono<Env>();

const AUTHORIZE_LIMIT_PER_MINUTE = 120;
const TOKEN_LIMIT_PER_MINUTE = 120;
const APPROVE_LIMIT_PER_MINUTE = 30;
const MAX_TOKEN_BODY_BYTES = 8192;
const MAX_QUERY_LENGTH = 4096;

const clientIp = (c: Context<Env>): string => c.req.header("cf-connecting-ip") || "unknown";

interface PageText {
	title: string;
	body: string;
	home: string;
}

const MESSAGES = {
	connecting: {
		id: "Menghubungkan ke RevKlik Books…",
		en: "Connecting to RevKlik Books…",
	},
	noScript: {
		id: "Aktifkan JavaScript untuk masuk ke RevKlik Books dengan akun RevKlik.",
		en: "Turn on JavaScript to sign in to RevKlik Books with your RevKlik account.",
	},
	failed: {
		id: "Tidak bisa melanjutkan ke RevKlik Books. Muat ulang halaman ini atau mulai lagi dari RevKlik Books.",
		en: "Could not continue to RevKlik Books. Reload this page or start again from RevKlik Books.",
	},
	client: {
		id: {
			title: "Aplikasi tidak dikenali",
			body: "Permintaan masuk ini berasal dari aplikasi yang tidak terdaftar di RevKlik.",
			home: "Ke RevKlik",
		},
		en: {
			title: "Unknown application",
			body: "This sign-in request comes from an application RevKlik does not recognise.",
			home: "Go to RevKlik",
		},
	},
	redirect: {
		id: {
			title: "Alamat kembali tidak diizinkan",
			body: "Alamat tujuan setelah masuk tidak terdaftar untuk aplikasi ini, jadi RevKlik tidak mengirim Anda ke sana.",
			home: "Ke RevKlik",
		},
		en: {
			title: "Return address not allowed",
			body: "The address to return to after sign-in is not registered for this application, so RevKlik did not send you there.",
			home: "Go to RevKlik",
		},
	},
	rateLimited: {
		id: {
			title: "Terlalu banyak permintaan",
			body: "Tunggu semenit, lalu coba lagi.",
			home: "Ke RevKlik",
		},
		en: {
			title: "Too many requests",
			body: "Wait a minute, then try again.",
			home: "Go to RevKlik",
		},
	},
} satisfies Record<string, Record<EmailLang, string | PageText>>;

const PAGE_STYLE =
	"body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem;box-sizing:border-box;font:16px/1.5 system-ui,sans-serif;color-scheme:light dark}main{max-width:28rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0 0 1rem}a{color:inherit}";

const randomNonce = (): string =>
	btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

/** Headers every page of this flow carries: no caching, no framing, no referrer, scripts by nonce only. */
function pageHeaders(nonce: string): Record<string, string> {
	return {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
	};
}

function htmlPage(lang: EmailLang, nonce: string, body: string, script = ""): string {
	return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>RevKlik</title><style nonce="${nonce}">${PAGE_STYLE}</style></head><body><main>${body}</main>${script}</body></html>`;
}

function errorPage(
	c: Context<Env>,
	status: 400 | 429,
	kind: "client" | "redirect" | "rateLimited",
): Response {
	const lang = resolveEmailLang(undefined, c.req.header("accept-language"));
	const text: PageText = MESSAGES[kind][lang];
	const nonce = randomNonce();
	const headers = pageHeaders(nonce);
	if (status === 429) headers["Retry-After"] = "60";
	return new Response(
		htmlPage(
			lang,
			nonce,
			`<h1>${text.title}</h1><p>${text.body}</p><p><a href="/">${text.home}</a></p>`,
		),
		{ status, headers },
	);
}

/**
 * The page /oauth/authorize serves once the request itself is valid. Its script
 * reads the dashboard token, trades the query string for a redirect at
 * POST /api/oauth/authorize, and follows it. No token (or a dead one) sends the
 * browser to /login, which returns here afterwards.
 */
function bridgePage(lang: EmailLang): Response {
	const nonce = randomNonce();
	const script = `<script nonce="${nonce}">
(() => {
	const message = document.getElementById("message");
	const fail = () => { message.textContent = ${JSON.stringify(MESSAGES.failed[lang])}; };
	const toLogin = () => location.replace("/login?next=" + encodeURIComponent(location.pathname + location.search));
	let token = null;
	try { token = localStorage.getItem("kp_token"); } catch { /* storage blocked */ }
	if (!token) { toLogin(); return; }
	fetch("/api/oauth/authorize", {
		method: "POST",
		headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
		body: JSON.stringify({ query: location.search }),
	}).then(async (res) => {
		if (res.status === 401) {
			try { localStorage.removeItem("kp_token"); localStorage.removeItem("kp_user"); } catch { /* storage blocked */ }
			toLogin();
			return;
		}
		const body = await res.json().catch(() => null);
		if (res.ok && body && typeof body.redirect_to === "string") location.replace(body.redirect_to);
		else fail();
	}).catch(fail);
})();
</script>`;
	const body = `<h1 id="message" role="status">${MESSAGES.connecting[lang]}</h1><noscript><p>${MESSAGES.noScript[lang]}</p></noscript>`;
	return new Response(htmlPage(lang, nonce, body, script), { headers: pageHeaders(nonce) });
}

// GET /oauth/authorize: validates the client and request, then hands over to the sign-in bridge.
oauthRoutes.get("/authorize", async (c) => {
	if (
		!(await allowRequest(
			c.env.RL_API_120,
			`oauth-authorize:${clientIp(c)}`,
			AUTHORIZE_LIMIT_PER_MINUTE,
		))
	) {
		return errorPage(c, 429, "rateLimited");
	}
	const check = checkAuthorizeRequest(c.env, new URL(c.req.url).searchParams);
	if (check.ok) return bridgePage(resolveEmailLang(undefined, c.req.header("accept-language")));
	if ("page" in check) return errorPage(c, 400, check.page);
	return c.redirect(check.redirectTo, 302);
});

// POST /oauth/token: Books' server redeems a code for the signed-in user's identity.
oauthRoutes.post("/token", async (c) => {
	c.header("Cache-Control", "no-store");
	c.header("Pragma", "no-cache");
	if (
		!(await allowRequest(c.env.RL_API_120, `oauth-token:${clientIp(c)}`, TOKEN_LIMIT_PER_MINUTE))
	) {
		c.header("Retry-After", "60");
		return c.json({ error: "too_many_requests" }, 429);
	}
	const db = c.get("db");
	if (!db) return c.json({ error: "temporarily_unavailable" }, 503);
	const contentType = c.req.header("content-type") ?? "";
	const raw = contentType.startsWith("application/x-www-form-urlencoded") ? await c.req.text() : "";
	if (!raw || raw.length > MAX_TOKEN_BODY_BYTES) return c.json({ error: "invalid_request" }, 400);

	const result = await exchangeAuthorizationCode(db, c.env, new URLSearchParams(raw));
	if (!result.ok) return c.json({ error: result.error }, 400);
	return c.json(result.identity);
});

// POST /api/oauth/authorize {query}: the signed-in user's approval of the request the bridge page carries.
oauthSessionRoutes.post("/authorize", async (c) => {
	const userId = c.get("userId");
	if (!(await allowRequest(c.env.RL_API_30, `oauth-approve:${userId}`, APPROVE_LIMIT_PER_MINUTE))) {
		return c.json({ error: "Too many requests", success: false }, 429);
	}
	const db = c.get("db");
	const body = await c.req.json<{ query?: unknown }>().catch(() => null);
	const query =
		typeof body?.query === "string" && body.query.length <= MAX_QUERY_LENGTH ? body.query : "";
	const check = checkAuthorizeRequest(c.env, new URLSearchParams(query));
	if ("page" in check) {
		const error = check.page === "client" ? "invalid_client" : "invalid_redirect_uri";
		return c.json({ error, success: false }, 400);
	}
	if (!check.ok) return c.json({ redirect_to: check.redirectTo, success: true });
	const code = await issueAuthorizationCode(db, userId, check.request);
	return c.json({ redirect_to: successRedirect(check.request, code), success: true });
});

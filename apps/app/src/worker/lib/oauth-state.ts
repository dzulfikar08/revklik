import { timingSafeEqual } from "./webhook-utils";

/** How long a user has to finish the consent screen. */
const STATE_TTL_MS = 10 * 60_000;

export interface OAuthStatePayload {
	/** User who started the flow. */
	u: string;
	/** Site the connection is for. */
	s: string;
}

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

async function sign(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))));
}

/**
 * Tamper-proof OAuth `state` binding the redirect to the user and site that started it,
 * so a callback cannot attach someone else's account to a victim's site.
 */
export async function signOAuthState(
	secret: string,
	payload: OAuthStatePayload,
	now = Date.now(),
): Promise<string> {
	const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, exp: now + STATE_TTL_MS })));
	return `${body}.${await sign(secret, body)}`;
}

/** The payload of a state this server signed and that has not expired, else null. */
export async function verifyOAuthState(
	secret: string,
	state: string,
	now = Date.now(),
): Promise<OAuthStatePayload | null> {
	const [body, signature, extra] = state.split(".");
	if (!body || !signature || extra !== undefined) return null;
	if (!timingSafeEqual(await sign(secret, body), signature)) return null;
	try {
		const padded = body.replaceAll("-", "+").replaceAll("_", "/");
		const parsed = JSON.parse(atob(padded)) as Partial<OAuthStatePayload> & { exp?: number };
		if (typeof parsed.u !== "string" || typeof parsed.s !== "string") return null;
		if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
		return { u: parsed.u, s: parsed.s };
	} catch {
		return null;
	}
}

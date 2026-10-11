import { timingSafeEqual } from "./webhook-utils";

/** Standard Webhooks replay window (spec default). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface StandardWebhookHeaders {
	id: string;
	timestamp: string;
	signature: string;
}

export type StandardWebhookVerdict = "ok" | "missing_headers" | "stale" | "invalid";

/**
 * Candidate HMAC keys for a secret. Polar's SDK signs with the secret's UTF-8
 * bytes; the Standard Webhooks spec base64-decodes a `whsec_` secret. Both are
 * accepted so either secret format verifies.
 */
function secretKeys(secret: string): Uint8Array[] {
	const keys: Uint8Array[] = [new TextEncoder().encode(secret)];
	const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
	try {
		keys.push(Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0)));
	} catch {
		/* not base64 — UTF-8 key only */
	}
	return keys;
}

async function hmacBase64(key: Uint8Array, message: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * Verify a Standard Webhooks delivery (Polar): HMAC-SHA256 over
 * `${id}.${timestamp}.${body}`, signature header holding space-separated
 * `v1,<base64>` entries, timestamp within WEBHOOK_TOLERANCE_SECONDS.
 */
export async function verifyStandardWebhook(
	body: string,
	headers: StandardWebhookHeaders,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): Promise<StandardWebhookVerdict> {
	if (!headers.id || !headers.timestamp || !headers.signature) return "missing_headers";
	const ts = Number(headers.timestamp);
	if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return "stale";

	const message = `${headers.id}.${headers.timestamp}.${body}`;
	const provided = headers.signature
		.split(" ")
		.map((entry) => (entry.startsWith("v1,") ? entry.slice(3) : entry));
	for (const key of secretKeys(secret)) {
		const computed = await hmacBase64(key, message);
		if (provided.some((value) => timingSafeEqual(computed, value))) return "ok";
	}
	return "invalid";
}

/** Produces the signature header value Polar would send (UTF-8 key form). */
export async function signStandardWebhook(
	body: string,
	id: string,
	timestamp: string,
	secret: string,
): Promise<string> {
	return `v1,${await hmacBase64(new TextEncoder().encode(secret), `${id}.${timestamp}.${body}`)}`;
}

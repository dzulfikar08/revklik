/**
 * Google Search Console access via a service account key (JWT bearer grant,
 * RFC 7523). Lets a site read GSC without the OAuth consent screen, so it
 * works while the OAuth app is unverified.
 */

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export class GscServiceAccountError extends Error {}

export interface GscServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri: string;
}

function b64url(input: string | Uint8Array): string {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
	const body = pem
		.replace(/-----BEGIN [^-]+-----/, "")
		.replace(/-----END [^-]+-----/, "")
		.replace(/\s+/g, "");
	const raw = atob(body);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

/** Parse the downloaded service account JSON key; throws GscServiceAccountError if unusable. */
export function parseServiceAccountKey(input: unknown): GscServiceAccountKey {
	let obj: unknown = input;
	if (typeof input === "string") {
		try {
			obj = JSON.parse(input);
		} catch {
			throw new GscServiceAccountError("Service account key is not valid JSON");
		}
	}
	if (!obj || typeof obj !== "object") {
		throw new GscServiceAccountError("Service account key must be a JSON object");
	}
	const k = obj as Record<string, unknown>;
	if (k.type !== undefined && k.type !== "service_account") {
		throw new GscServiceAccountError('Key JSON "type" must be "service_account"');
	}
	const clientEmail = k.client_email;
	const privateKey = k.private_key;
	if (typeof clientEmail !== "string" || !clientEmail.includes("@")) {
		throw new GscServiceAccountError('Key JSON is missing "client_email"');
	}
	if (typeof privateKey !== "string" || !privateKey.includes("BEGIN PRIVATE KEY")) {
		throw new GscServiceAccountError('Key JSON is missing a PKCS#8 "private_key"');
	}
	const tokenUri = typeof k.token_uri === "string" && k.token_uri ? k.token_uri : DEFAULT_TOKEN_URI;
	if (tokenUri !== DEFAULT_TOKEN_URI) {
		throw new GscServiceAccountError(`token_uri must be ${DEFAULT_TOKEN_URI}`);
	}
	return { client_email: clientEmail, private_key: privateKey, token_uri: tokenUri };
}

/** Sign the RS256 assertion JWT for the bearer grant (1 hour validity). */
export async function signServiceAccountJwt(
	key: GscServiceAccountKey,
	now = Date.now(),
): Promise<string> {
	let cryptoKey: CryptoKey;
	try {
		cryptoKey = await crypto.subtle.importKey(
			"pkcs8",
			pemToPkcs8(key.private_key),
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["sign"],
		);
	} catch {
		throw new GscServiceAccountError("private_key is not a valid RSA PKCS#8 PEM key");
	}
	const iat = Math.floor(now / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = b64url(
		JSON.stringify({
			iss: key.client_email,
			scope: GSC_SCOPE,
			aud: key.token_uri,
			iat,
			exp: iat + 3600,
		}),
	);
	const sig = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

/** Exchange a signed assertion for a short-lived access token. */
export async function fetchServiceAccountAccessToken(
	key: GscServiceAccountKey,
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	const assertion = await signServiceAccountJwt(key);
	const res = await fetchImpl(key.token_uri, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion,
		}),
	});
	const data = (await res.json()) as {
		access_token?: string;
		error?: string;
		error_description?: string;
	};
	if (!res.ok || !data.access_token) {
		throw new GscServiceAccountError(
			`Service account token request failed: ${data.error_description || data.error || res.status}`,
		);
	}
	return data.access_token;
}

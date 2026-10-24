import { describe, expect, it } from "bun:test";
import {
	fetchServiceAccountAccessToken,
	GSC_SCOPE,
	GscServiceAccountError,
	parseServiceAccountKey,
	signServiceAccountJwt,
} from "./gsc-service-account";

async function rsaPem(): Promise<{ pem: string; publicKey: CryptoKey }> {
	const pair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
	const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
	return {
		pem: `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`,
		publicKey: pair.publicKey,
	};
}

function fromB64url(s: string): Uint8Array {
	const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

describe("parseServiceAccountKey", () => {
	it("accepts a JSON string or object and defaults token_uri", () => {
		const obj = {
			type: "service_account",
			client_email: "gsc@p.iam.gserviceaccount.com",
			private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
		};
		expect(parseServiceAccountKey(obj).token_uri).toBe("https://oauth2.googleapis.com/token");
		expect(parseServiceAccountKey(JSON.stringify(obj)).client_email).toBe(obj.client_email);
	});

	it("rejects bad input", () => {
		expect(() => parseServiceAccountKey("nope")).toThrow(GscServiceAccountError);
		expect(() => parseServiceAccountKey({ client_email: "a@b" })).toThrow(GscServiceAccountError);
		expect(() =>
			parseServiceAccountKey({
				client_email: "a@b",
				private_key: "-----BEGIN PRIVATE KEY-----x",
				token_uri: "https://evil.example/token",
			}),
		).toThrow(GscServiceAccountError);
	});
});

describe("service account JWT", () => {
	it("signs a verifiable RS256 assertion with scope and audience", async () => {
		const { pem, publicKey } = await rsaPem();
		const key = {
			client_email: "gsc@p.iam.gserviceaccount.com",
			private_key: pem,
			token_uri: "https://oauth2.googleapis.com/token",
		};
		const jwt = await signServiceAccountJwt(key, 1_800_000_000_000);
		const [h, p, s] = jwt.split(".") as [string, string, string];
		expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({
			alg: "RS256",
			typ: "JWT",
		});
		const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
		expect(claims).toEqual({
			iss: key.client_email,
			scope: GSC_SCOPE,
			aud: key.token_uri,
			iat: 1_800_000_000,
			exp: 1_800_003_600,
		});
		const ok = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			publicKey,
			fromB64url(s),
			new TextEncoder().encode(`${h}.${p}`),
		);
		expect(ok).toBe(true);
	});

	it("exchanges the assertion via the jwt-bearer grant", async () => {
		const { pem } = await rsaPem();
		let sent: URLSearchParams | undefined;
		const fake = (async (_url: string, init: RequestInit) => {
			sent = init.body as URLSearchParams;
			return Response.json({ access_token: "tok" });
		}) as unknown as typeof fetch;
		const token = await fetchServiceAccountAccessToken(
			{ client_email: "a@b", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" },
			fake,
		);
		expect(token).toBe("tok");
		expect(sent?.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
		expect(sent?.get("assertion")?.split(".")).toHaveLength(3);
	});

	it("surfaces Google errors", async () => {
		const { pem } = await rsaPem();
		const fake = (async () =>
			Response.json({ error: "invalid_grant", error_description: "bad" }, {
				status: 400,
			})) as unknown as typeof fetch;
		await expect(
			fetchServiceAccountAccessToken(
				{ client_email: "a@b", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" },
				fake,
			),
		).rejects.toThrow("bad");
	});
});

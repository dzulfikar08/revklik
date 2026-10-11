export interface WebhookResult {
	siteId: string;
	amount: number;
	currency: string;
	paymentMethod: string;
	provider: string;
	orderId: string;
	sessionId?: string;
	utmSource?: string;
	utmCampaign?: string;
	subscriptionId?: string;
	eventType: "payment" | "subscription" | "refund";
}

export async function verifyMidtransSignature(
	orderId: string,
	statusCode: string,
	grossAmount: string,
	serverKey: string,
	signatureKey: string,
): Promise<boolean> {
	const input = `${orderId}${statusCode}${grossAmount}${serverKey}`;
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-512", data);
	const computed = Array.from(new Uint8Array(hashBuffer), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	if (computed.length !== signatureKey.length) return false;
	let result = 0;
	for (let i = 0; i < computed.length; i++) {
		result |= computed.charCodeAt(i) ^ signatureKey.charCodeAt(i);
	}
	return result === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

export function parseMidtransPaymentMethod(paymentType: string): string {
	const map: Record<string, string> = {
		gopay: "gopay",
		qris: "qris",
		bank_transfer: "va",
		credit_card: "credit_card",
		echannel: "va_mandiri",
		bca_va: "va_bca",
		bni_va: "va_bni",
		bri_va: "va_bri",
		cstore: "cstore",
		shopeepay: "shopeepay",
		ovo: "ovo",
		dana: "dana",
		linkaja: "linkaja",
		kredivo: "kredivo",
		akulaku: "akulaku",
	};
	return map[paymentType] || paymentType;
}

export function mapXenditMethod(_method: string, channel: string): string {
	const channelMap: Record<string, string> = {
		OVO: "ovo",
		DANA: "dana",
		LINKAJA: "linkaja",
		SHOPEEPAY: "shopeepay",
		BCA: "va_bca",
		BNI: "va_bni",
		BRI: "va_bri",
		MANDIRI: "va_mandiri",
		PERMATA: "va_permata",
		QR_CODE: "qris",
	};
	return channelMap[channel] || channel.toLowerCase();
}

/** Stripe's replay window for the `t=` timestamp (their library default). */
export const STRIPE_TOLERANCE_SECONDS = 300;

/**
 * Stripe-Signature: `t=<unix>,v1=<hex>[,v1=<hex>...]`. The HMAC-SHA256 key is
 * the whole endpoint secret as UTF-8 (whsec_ prefix included) over
 * `${t}.${payload}`. Any v1 entry may match; never throws.
 */
export async function verifyStripeSignature(
	payload: string,
	signatureHeader: string,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
	try {
		let timestamp = "";
		const signatures: string[] = [];
		for (const part of signatureHeader.split(",")) {
			const eqIdx = part.indexOf("=");
			if (eqIdx === -1) continue;
			const key = part.slice(0, eqIdx).trim();
			const value = part.slice(eqIdx + 1).trim();
			if (key === "t") timestamp = value;
			else if (key === "v1") signatures.push(value);
		}
		const ts = Number(timestamp);
		if (!timestamp || !Number.isFinite(ts) || signatures.length === 0) return false;
		if (Math.abs(nowSeconds - ts) > STRIPE_TOLERANCE_SECONDS) return false;

		const enc = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			enc.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
		const computed = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join(
			"",
		);
		let matched = false;
		for (const candidate of signatures) {
			if (timingSafeEqual(computed, candidate)) matched = true;
		}
		return matched;
	} catch {
		return false;
	}
}

export async function verifyLemonSqueezySignature(
	payload: string,
	signatureHeader: string,
	secret: string,
): Promise<boolean> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
	const computed = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
	return timingSafeEqual(computed, signatureHeader);
}

export function mapStripePaymentMethod(type: string): string {
	const map: Record<string, string> = {
		card: "Credit Card",
		grabpay: "GrabPay",
		fpx: "FPX",
		alipay: "Alipay",
		wechat: "WeChat Pay",
		bank_transfer: "Bank Transfer",
		promptpay: "PromptPay",
		oxxo: "OXXO",
	};
	return map[type] || type;
}

export function categorizeChannel(
	referrer: string | null,
	_utmSource: string | null,
	utmMedium: string | null,
): string {
	if (utmMedium === "cpc" || utmMedium === "ppc" || utmMedium === "paid") return "Paid";
	if (utmMedium === "email") return "Email";
	if (utmMedium === "social" || utmMedium === "social-media") return "Social Media";
	if (!referrer) return "Direct";
	const social = [
		"facebook.com",
		"twitter.com",
		"x.com",
		"instagram.com",
		"tiktok.com",
		"linkedin.com",
		"youtube.com",
		"reddit.com",
	];
	const search = [
		"google.com",
		"bing.com",
		"yahoo.com",
		"baidu.com",
		"duckduckgo.com",
		"yandex.com",
		"google.co.id",
	];
	const ref = referrer.toLowerCase();
	if (social.some((s) => ref.includes(s))) return "Social Media";
	if (search.some((s) => ref.includes(s))) return "Organic Search";
	return "Referral";
}

/**
 * DOKU SNAP notification signature (X-SIGNATURE header): HMAC-SHA512 over
 * `HTTP-METHOD:RELATIVE-URL:ACCESS-TOKEN:HEX(SHA256(requestBody)):TIMESTAMP`
 * keyed with the merchant's clientSecret. Docs: developers.doku.com,
 * "HTTP Notification Sample for SNAP" — verification steps 1-3.
 * The access token is the Authorization header value without a Bearer prefix;
 * the relative URL is the notification path the merchant registered.
 */
export async function verifyDokuSignature(opts: {
	httpMethod: string;
	relativeUrl: string;
	authorizationHeader: string;
	requestBody: string;
	timestamp: string;
	clientSecret: string;
	signature: string;
}): Promise<boolean> {
	const accessToken = opts.authorizationHeader.replace(/^Bearer\s+/i, "");
	const bodyHash = Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(opts.requestBody)),
		),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");
	const stringToSign = [
		opts.httpMethod.toUpperCase(),
		opts.relativeUrl,
		accessToken,
		bodyHash,
		opts.timestamp,
	].join(":");
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(opts.clientSecret),
		{ name: "HMAC", hash: "SHA-512" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
	const computed = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
	return timingSafeEqual(computed, opts.signature.toLowerCase());
}

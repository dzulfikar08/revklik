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

export async function verifyStripeSignature(
	payload: string,
	signatureHeader: string,
	secret: string,
): Promise<boolean> {
	// Stripe-Signature header format: t=timestamp,v1=signature[,v1=signature...]
	const parts = signatureHeader.split(",");
	let timestamp = "";
	let v1Signature = "";
	for (const part of parts) {
		const eqIdx = part.indexOf("=");
		if (eqIdx === -1) continue;
		const key = part.slice(0, eqIdx);
		const value = part.slice(eqIdx + 1);
		if (key === "t") timestamp = value;
		else if (key === "v1") v1Signature = value;
	}
	if (!timestamp || !v1Signature) return false;

	const signedPayload = `${timestamp}.${payload}`;

	// Decode the whsec_ prefixed secret from base64
	const rawSecret = secret.startsWith("whsec_") ? secret.slice(7) : secret;
	const secretBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		secretBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
	const computed = Array.from(new Uint8Array(sig), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

	return timingSafeEqual(computed, v1Signature);
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
	const computed = Array.from(new Uint8Array(sig), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	return timingSafeEqual(computed, signatureHeader);
}

// Polar webhooks: same scheme as Stripe (Webhook-Signature: t=<ts>,v1=<hex>), but the
// secret is a plain string (not the base64 whsec_ form Stripe uses).
export async function verifyPolarSignature(
	payload: string,
	signatureHeader: string,
	secret: string,
): Promise<boolean> {
	const parts = signatureHeader.split(",");
	let timestamp = "";
	let v1Signature = "";
	for (const part of parts) {
		const eqIdx = part.indexOf("=");
		if (eqIdx === -1) continue;
		const key = part.slice(0, eqIdx);
		const value = part.slice(eqIdx + 1);
		if (key === "t") timestamp = value;
		else if (key === "v1") v1Signature = value;
	}
	if (!timestamp || !v1Signature) return false;

	const signedPayload = `${timestamp}.${payload}`;
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
	const computed = Array.from(new Uint8Array(sig), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	return timingSafeEqual(computed, v1Signature);
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
	if (utmMedium === "cpc" || utmMedium === "ppc" || utmMedium === "paid")
		return "Paid";
	if (utmMedium === "email") return "Email";
	if (utmMedium === "social" || utmMedium === "social-media")
		return "Social Media";
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

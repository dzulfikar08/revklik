export async function hashPassword(password: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(password);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	const passwordHash = await hashPassword(password);
	return passwordHash === hash;
}

export function generateApiKey(type: "session" | "account" | "site" = "session"): {
	key: string;
	hash: string;
	prefix: string;
} {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	const prefixMap = { session: "kp_", account: "rvt_", site: "rv_" };
	const key = `${prefixMap[type]}${hex}`;
	const prefix = key.slice(0, 7);
	return { key, hash: prefix, prefix };
}

export async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(token);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateId(): string {
	return crypto.randomUUID();
}

// Known crawler / bot / headless user-agent markers. Matched case-insensitively as
// substrings of the User-Agent header. Kept as a plain list so it stays greppable —
// add specific products, not broad words ("bot" alone matches legit UX strings).
const BOT_UA_MARKERS = [
	// Search & AI crawlers
	"googlebot",
	"bingbot",
	"duckduckbot",
	"yandexbot",
	"yandeximages",
	"baiduspider",
	"sogou",
	"slurp",
	"applebot",
	"petalbot",
	"bytespider",
	"gptbot",
	"claudebot",
	"ccbot",
	"anthropic-ai",
	"perplexitybot",
	"google-extended",
	"amazonbot",
	"facebookexternalhit",
	"twitterbot",
	"linkedinbot",
	"embedly",
	"discordapp",
	"telegrambot",
	"whatsapp",
	"slack-imglib",
	"preview",
	// SEO tools
	"ahrefsbot",
	"semrushbot",
	"mj12bot",
	"dotbot",
	"serpstatbot",
	"screaming frog",
	"dataforseo",
	// Headless browsers & automation frameworks
	"headlesschrome",
	"phantomjs",
	"slimerjs",
	"puppeteer",
	"playwright",
	"lighthouse",
	"pagespeed",
	"chrome-lighthouse",
	// HTTP libraries & scrapers (no real browser sends these)
	"python-requests",
	"python-urllib",
	"aiohttp",
	"httpx",
	"scrapy",
	"httrack",
	"libwww-perl",
	"curl/",
	"wget/",
	"go-http-client",
	"okhttp",
	"apache-httpclient",
	"java/",
	"node-fetch",
	"axios/",
	"gaxios",
	// Uptime monitors & synthetic checks
	"uptimerobot",
	"pingdom",
	"betteruptime",
	"statuscake",
	"site24x7",
	"cron-job.org",
];

const BOT_UA_RE = new RegExp(BOT_UA_MARKERS.join("|"), "i");

/** True when the request looks like a crawler or headless client rather than a human. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
	// Real browsers always send User-Agent; an absent one means a scripted client.
	if (!ua) return true;
	return BOT_UA_RE.test(ua);
}

export async function fingerprintFromRequest(req: Request, screenRes?: string): Promise<string> {
	const ip =
		req.headers.get("cf-connecting-ip") ??
		req.headers.get("x-forwarded-for")?.split(",")[0] ??
		"unknown";
	const ua = req.headers.get("user-agent") ?? "";
	const lang = req.headers.get("accept-language") ?? "";
	const input = `${ip}|${ua}|${lang}|${screenRes ?? ""}`;
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getDateRange(range: string): { start: Date; end: Date } {
	const end = new Date();
	const start = new Date();

	if (range.includes(",")) {
		const parts = range.split(",");
		const s = new Date(parts[0] ?? "");
		const e = new Date(parts[1] ?? "");
		if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
			return { start: s, end: e };
		}
	}

	switch (range) {
		case "7d":
			start.setDate(start.getDate() - 7);
			break;
		case "30d":
			start.setDate(start.getDate() - 30);
			break;
		case "90d":
			start.setDate(start.getDate() - 90);
			break;
		case "24h":
			start.setHours(start.getHours() - 24);
			break;
		default:
			start.setDate(start.getDate() - 7);
	}

	return { start, end };
}

/**
 * Infer a country code from an IANA timezone string.
 * Used as a fallback when Cloudflare CF-IPCountry is not available.
 * Only covers the most common timezone-to-country mappings.
 */
const tzCountryMap: Record<string, string> = {
	"America/New_York": "US",
	"America/Chicago": "US",
	"America/Denver": "US",
	"America/Los_Angeles": "US",
	"America/Phoenix": "US",
	"America/Anchorage": "US",
	"Pacific/Honolulu": "US",
	"America/Indiana/Indianapolis": "US",
	"Europe/London": "GB",
	"Europe/Dublin": "IE",
	"Europe/Paris": "FR",
	"Europe/Berlin": "DE",
	"Europe/Madrid": "ES",
	"Europe/Rome": "IT",
	"Europe/Amsterdam": "NL",
	"Europe/Brussels": "BE",
	"Europe/Zurich": "CH",
	"Europe/Vienna": "AT",
	"Europe/Stockholm": "SE",
	"Europe/Oslo": "NO",
	"Europe/Copenhagen": "DK",
	"Europe/Helsinki": "FI",
	"Europe/Warsaw": "PL",
	"Europe/Prague": "CZ",
	"Europe/Budapest": "HU",
	"Europe/Bucharest": "RO",
	"Europe/Athens": "GR",
	"Europe/Lisbon": "PT",
	"Asia/Jakarta": "ID",
	"Asia/Makassar": "ID",
	"Asia/Jayapura": "ID",
	"Asia/Bangkok": "TH",
	"Asia/Ho_Chi_Minh": "VN",
	"Asia/Manila": "PH",
	"Asia/Kuala_Lumpur": "MY",
	"Asia/Singapore": "SG",
	"Asia/Tokyo": "JP",
	"Asia/Seoul": "KR",
	"Asia/Shanghai": "CN",
	"Asia/Hong_Kong": "HK",
	"Asia/Taipei": "TW",
	"Asia/Kolkata": "IN",
	"Asia/Karachi": "PK",
	"Asia/Dhaka": "BD",
	"Asia/Dubai": "AE",
	"Asia/Riyadh": "SA",
	"Asia/Tehran": "IR",
	"Australia/Sydney": "AU",
	"Australia/Melbourne": "AU",
	"Australia/Brisbane": "AU",
	"Australia/Perth": "AU",
	"Australia/Adelaide": "AU",
	"Pacific/Auckland": "NZ",
	"America/Toronto": "CA",
	"America/Vancouver": "CA",
	"America/Edmonton": "CA",
	"America/Winnipeg": "CA",
	"America/Halifax": "CA",
	"America/Mexico_City": "MX",
	"America/Sao_Paulo": "BR",
	"America/Buenos_Aires": "AR",
	"America/Lima": "PE",
	"America/Bogota": "CO",
	"America/Santiago": "CL",
	"Africa/Cairo": "EG",
	"Africa/Lagos": "NG",
	"Africa/Johannesburg": "ZA",
	"Africa/Nairobi": "KE",
	"Africa/Casablanca": "MA",
	"Africa/Accra": "GH",
	"Africa/Addis_Ababa": "ET",
};

export function countryFromTimezone(tz: string | null | undefined): string | null {
	if (!tz) return null;
	return tzCountryMap[tz] ?? null;
}

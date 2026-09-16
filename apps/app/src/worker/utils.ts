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
	// WhatsApp's link-preview fetcher sends a bare "WhatsApp/x.y" UA with no
	// Mozilla token. Human clicks from the WhatsApp in-app browser send a real
	// browser UA that may also carry the token (iOS) — those are visitors, and
	// track.ts overrides their browser so source attribution can classify them.
	if (/^whatsapp\//i.test(ua)) return true;
	return BOT_UA_RE.test(ua);
}

export type CrawlerCategory = "ai_answers" | "indexing" | "training" | "other";

export interface CrawlerClassification {
	bot: string;
	category: CrawlerCategory;
}

// AI-crawler registry: marker (substring, case-insensitive) -> product + purpose.
// Purposes follow each vendor's documented crawler list. Order matters only for
// overlapping markers (longer form first, e.g. applebot-extended before applebot).
const AI_CRAWLERS: Array<{ marker: string; bot: string; category: CrawlerCategory }> = [
	// OpenAI
	{ marker: "chatgpt-user", bot: "ChatGPT", category: "ai_answers" },
	{ marker: "oai-searchbot", bot: "ChatGPT", category: "indexing" },
	{ marker: "gptbot", bot: "ChatGPT", category: "training" },
	// Anthropic
	{ marker: "claude-user", bot: "Claude", category: "ai_answers" },
	{ marker: "claude-searchbot", bot: "Claude", category: "indexing" },
	{ marker: "claudebot", bot: "Claude", category: "training" },
	{ marker: "anthropic-ai", bot: "Claude", category: "training" },
	// Google / Gemini
	{ marker: "google-extended", bot: "Gemini", category: "training" },
	{ marker: "googlebot", bot: "Google", category: "indexing" },
	// Apple (applebot-extended must precede applebot — substring)
	{ marker: "applebot-extended", bot: "Apple", category: "training" },
	{ marker: "applebot", bot: "Apple", category: "indexing" },
	// Perplexity
	{ marker: "perplexity-user", bot: "Perplexity", category: "ai_answers" },
	{ marker: "perplexitybot", bot: "Perplexity", category: "indexing" },
	// DuckDuckGo
	{ marker: "duckassistbot", bot: "DuckDuckGo", category: "ai_answers" },
	{ marker: "duckduckbot", bot: "DuckDuckGo", category: "indexing" },
	// Model trainers
	{ marker: "meta-externalagent", bot: "Meta AI", category: "training" },
	{ marker: "bytespider", bot: "ByteDance", category: "training" },
	{ marker: "ccbot", bot: "Common Crawl", category: "training" },
	{ marker: "amazonbot", bot: "Amazon", category: "training" },
	{ marker: "cohere-ai", bot: "Cohere", category: "training" },
	{ marker: "mistralai-training", bot: "Mistral", category: "training" },
	{ marker: "mistralai-user", bot: "Mistral", category: "ai_answers" },
	{ marker: "pangubot", bot: "Huawei", category: "training" },
	{ marker: "imagesift", bot: "Hive", category: "training" },
	{ marker: "diffbot", bot: "Diffbot", category: "training" },
	{ marker: "youbot", bot: "You.com", category: "ai_answers" },
];

const AI_CRAWLERS_LOWER = AI_CRAWLERS.map((c) => ({
	marker: c.marker.toLowerCase(),
	bot: c.bot,
	category: c.category,
}));

/**
 * Classify a User-Agent as a crawler hit. Returns null for real browsers.
 * AI products get a named bot + purpose (ai_answers / indexing / training);
 * every other bot (headless, scrapers, monitors, social previews) falls into
 * the "other" bucket.
 */
export function classifyCrawler(ua: string | null | undefined): CrawlerClassification | null {
	if (!ua) return { bot: "Unknown", category: "other" };
	const lower = ua.toLowerCase();
	for (const c of AI_CRAWLERS_LOWER) {
		if (lower.includes(c.marker)) return { bot: c.bot, category: c.category };
	}
	if (isBotUserAgent(ua)) return { bot: "Other", category: "other" };
	return null;
}

// Hosting/cloud network organizations. Automation that ships a real browser UA
// cannot be caught by the marker list above, so the ASN organization is the
// remaining signal. Matched case-insensitively as substrings of Cloudflare's
// `asOrganization`. Consumer ISP orgs must never appear here: those are people.
// This list is the tuning knob; add an org only after seeing it in crawler_hits.
const DATACENTER_AS_ORGS = [
	"digitalocean",
	"amazon",
	"microsoft",
	"google cloud",
	"google-cloud",
	"google llc",
	"ovh",
	"hetzner",
	"contabo",
	"linode",
	"vultr",
	"the constant company",
	"oracle",
	"alibaba",
	"tencent",
	"bytedance",
	"scaleway",
	"leaseweb",
	"colocrossing",
	"hostwinds",
	"m247",
	"datacamp",
	"datapacket",
	"choopa",
	"gcore",
	"upcloud",
	"kamatera",
	"ionos",
	"netcup",
	"worldstream",
	"i3d",
	"servers.com",
	"zenlayer",
	"rackspace",
	"liquidweb",
	"hostinger",
	"namecheap",
	"godaddy",
	"fastly",
	"bunny",
	"cloudflare",
	"backblaze",
	"wasabi",
	"fly.io",
	"heroku",
	"vercel",
	"netlify",
	"censys",
	"shodan",
	"shadowserver",
	"proofpoint",
	"mimecast",
];

/**
 * True when the request's network is a hosting/cloud provider rather than a
 * consumer ISP. Returns the matched organization name (for the crawler log) or
 * null for networks treated as human. `asOrganization` comes from
 * Cloudflare's `request.cf`; it is undefined in local dev and in tests.
 */
export function classifyDatacenterVisitor(
	asOrganization: string | null | undefined,
): string | null {
	if (!asOrganization) return null;
	const lower = asOrganization.toLowerCase();
	for (const org of DATACENTER_AS_ORGS) {
		if (lower.includes(org)) return asOrganization;
	}
	return null;
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

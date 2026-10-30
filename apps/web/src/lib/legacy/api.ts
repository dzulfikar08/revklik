/**
 * Client for the revklik (klikapa) Worker API.
 *
 * The analytics UI reads live data from the deployed backend (app.revklik.com
 * for the hosted product, the serving origin when self-hosted), same routes
 * the old dashboard uses. Auth is a klikapa session token sent as a Bearer header; responses
 * use the `{ success, data, error }` envelope.
 *
 * The token comes from klikapa's own auth: email+password (/auth/login,
 * /auth/register) or Google OAuth (the callback lands on /#token=…, which
 * the root route captures). It is cached in memory and localStorage.
 */

import { getLocale } from "../i18n";
import { clearTokenMap, forgetToken, listRememberedTokens, rememberToken } from "./account-tokens";

const HOSTED_API_BASE = "https://app.revklik.com/api";

/**
 * Where the API lives: VITE_LEGACY_API_BASE when set at build time; else the
 * origin serving the SPA (the worker serves both, which is how self-hosted
 * installs work); else the hosted API (dev servers, native shells, tests).
 */
const defaultApiBase = (): string => {
	if (typeof window === "undefined") {
		return HOSTED_API_BASE;
	}
	const { protocol, hostname, origin } = window.location;
	const servedByWorker =
		(protocol === "https:" || protocol === "http:") &&
		hostname !== "localhost" &&
		hostname !== "127.0.0.1";
	return servedByWorker ? `${origin}/api` : HOSTED_API_BASE;
};

const API_BASE: string = import.meta.env.VITE_LEGACY_API_BASE ?? defaultApiBase();
export const LEGACY_API_BASE = API_BASE;

// Dev-only escape hatch: inject a pre-existing klikapa token via env instead
// of minting one. Never compiled into production builds.
const ENV_TOKEN: string | undefined = import.meta.env.DEV
	? import.meta.env.VITE_LEGACY_API_TOKEN
	: undefined;

const TOKEN_KEY = "kp_token";
const USER_KEY = "kp_user";

let cachedToken: string | null = null;

/**
 * Session token resolution: in-memory cache → localStorage → dev env token.
 * Returns null when signed out; callers either redirect to /login or send
 * the request without a Bearer header.
 */
export const getToken = async (): Promise<string | null> => {
	if (cachedToken) {
		return cachedToken;
	}
	const stored = localStorage.getItem(TOKEN_KEY);
	if (stored) {
		cachedToken = stored;
		return stored;
	}
	if (ENV_TOKEN) {
		cachedToken = ENV_TOKEN;
		return ENV_TOKEN;
	}
	return null;
};

export interface LegacyUser {
	id: string;
	name: string;
	email: string;
	role: string;
	/** From /auth/me; absent on older workers (treated as verified). */
	email_verified?: boolean;
}

export interface LegacyStats {
	pageviews: number;
	visitors: number;
	sessions: number;
	bounceRate: number;
	avgDuration: number;
	revenue: number;
	conversions: number;
}

export interface StatsChange {
	current: number;
	previous: number;
	changePct: number | null;
}

export type CompareKey =
	| "pageviews"
	| "visitors"
	| "sessions"
	| "bounceRate"
	| "avgDuration"
	| "revenue"
	| "conversions";

export interface TimeSeriesPoint {
	date: string;
	pageviews: number;
	visitors: number;
}

export interface TopPage {
	path: string;
	pageviews: number;
	visitors: number;
}

export interface SourceEntry {
	source: string;
	visitors: number;
	percentage: number;
}

export interface DeviceEntry {
	device: string;
	visitors: number;
	percentage: number;
}

export interface ChannelEntry {
	channel: string;
	visitors: number;
	pageviews: number;
	revenue: number;
	percentage: number;
}

export interface RevenueBySource {
	source: string;
	revenue: number;
	conversions: number;
}

export interface RevenueByCountry {
	country: string;
	revenue: number;
	conversions: number;
}

export interface EntryPageRevenue {
	path: string;
	sessions: number;
	conversions: number;
	revenue: number;
}

export interface RevenueByPaymentMethod {
	method: string;
	count: number;
	revenue: number;
}

export interface RevenueByPaymentProvider {
	provider: string;
	count: number;
	revenue: number;
}

export interface CampaignPerformance {
	utm_source: string;
	utm_medium: string;
	utm_campaign: string;
	visitors: number;
	pageviews: number;
	conversions: number;
	revenue: number;
	conversionRate: number;
}

export interface JourneyStep {
	path: string;
	event_type: string;
	name: string | null;
	timestamp: string;
	revenue: number | null;
	props: string | null;
}

export interface VisitorJourney {
	session_id: string;
	visitor_id: string;
	visitor_name: string | null;
	visitor_email: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	utm_source: string | null;
	referrer: string | null;
	started_at: string;
	steps: JourneyStep[];
	total_revenue: number;
	is_identified: boolean;
}

export interface LegacyFunnelStep {
	section: string;
	visitors: number;
	percentage: number;
	dropoff: number;
}

export interface LegacyPageFunnel {
	path: string;
	steps: LegacyFunnelStep[];
	totalVisitors: number;
	conversionRate: number;
}

export interface ScrollFunnel {
	steps: LegacyFunnelStep[];
	totalVisitors: number;
	conversionRate: number;
	pages: LegacyPageFunnel[];
}

export interface VisitorProfile {
	id: string;
	visitor_id: string;
	name: string | null;
	email: string | null;
	phone: string | null;
	avatar: string | null;
	first_seen: string;
	last_seen: string;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	total_sessions: number;
	total_pageviews: number;
	total_revenue: number;
	tags: string | null;
	notes: string | null;
}

export interface GeoRow {
	country: string | null;
	region: string | null;
	city: string | null;
	visitors: number;
}

export interface ExitPage {
	path: string;
	exits: number;
}

export interface SiteWithStats {
	id: string;
	name: string;
	domain: string;
	created_at: string;
	pageviews: number;
	visitors: number;
	sparkline: number[];
	revenue: number;
	revenue_sparkline: number[];
	/** ISO currency of `revenue`; USD when absent. */
	currency?: string;
	/** True once the site has ever received an event (any range). */
	has_events?: boolean;
}

export interface SiteDashboard {
	/** ISO currency of every revenue figure below; USD when absent. */
	currency?: string;
	stats: LegacyStats;
	compare?: Partial<Record<CompareKey, StatsChange>>;
	timeseries: TimeSeriesPoint[];
	topPages: TopPage[];
	sources: SourceEntry[];
	devices: DeviceEntry[];
	os: DeviceEntry[];
	browsers: DeviceEntry[];
	journeys: VisitorJourney[];
	revenueBySource: RevenueBySource[];
	revenueByCountry: RevenueByCountry[];
	revenueTimeseries: { date: string; revenue: number; conversions: number }[];
	channels: ChannelEntry[];
	entryPagesRevenue: EntryPageRevenue[];
	exitPages: ExitPage[];
	revenueByMethod: RevenueByPaymentMethod[];
	revenueByProvider: RevenueByPaymentProvider[];
}

export type FilterOperator =
	| "is"
	| "is_not"
	| "contains"
	| "not_contains"
	| "starts_with"
	| "exists"
	| "not_exists";

export interface LegacyFilter {
	dimension: string;
	operator: FilterOperator;
	value: string;
}

/* ---------------------------------- auth ---------------------------------- */

export const getLegacyUser = (): LegacyUser | null => {
	try {
		const raw = localStorage.getItem(USER_KEY);
		return raw ? (JSON.parse(raw) as LegacyUser) : null;
	} catch {
		return null;
	}
};

/** Drop the cached klikapa token + profile (sign-out or 401 recovery). */
export const legacyLogout = (): void => {
	const user = getLegacyUser();
	if (user) {
		forgetToken(localStorage, user.id);
	}
	cachedToken = null;
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(USER_KEY);
	localStorage.removeItem("kp_active_site");
};

/**
 * Make `token` the active session for `user` and remember it in kp_tokens so
 * the account switcher can come back to it.
 */
export const setLegacySession = (token: string, user: LegacyUser): void => {
	cachedToken = token;
	localStorage.setItem(TOKEN_KEY, token);
	localStorage.setItem(USER_KEY, JSON.stringify(user));
	rememberToken(localStorage, user.id, token);
};

/** Optional machine-readable fields some error envelopes carry. */
export interface LegacyErrorBody {
	error?: string;
	required_plan?: string;
	grace_days_remaining?: number;
	quota?: { limit: number; used: number; plan: string };
}

export class LegacyApiError extends Error {
	status: number;
	/** The envelope's `error` string, e.g. "subscription_inactive". */
	code: string | undefined;
	body: LegacyErrorBody | undefined;
	constructor(message: string, status: number, body?: LegacyErrorBody) {
		super(message);
		this.name = "LegacyApiError";
		this.status = status;
		this.body = body;
		this.code = body?.error;
	}
}

/** snake_case error codes are meant for code paths, not for display. */
const ERROR_CODE = /^[a-z]+(?:_[a-z]+)+$/u;

/** The envelope's error if it is prose; null for a code or nothing. */
export const readableError = (error: string | undefined | null): string | null =>
	error && !ERROR_CODE.test(error) ? error : null;

/** 402 from a gated read: the trial or subscription has lapsed. */
export const isSubscriptionInactive = (err: unknown): err is LegacyApiError =>
	err instanceof LegacyApiError &&
	(err.code === "subscription_inactive" || (err.status === 402 && !err.code));

/**
 * 403 for a feature or quota above the current plan. Covers the explicit
 * `plan_required` envelope and the older site-limit response (403 + quota).
 */
export const isPlanRequired = (err: unknown): err is LegacyApiError =>
	err instanceof LegacyApiError &&
	err.status === 403 &&
	(err.code === "plan_required" || err.body?.quota !== undefined);

/**
 * Shared email/password auth: POST to a klikapa auth endpoint, persist the
 * returned session token + user, and surface the API's error message
 * ("Invalid credentials", "Email taken", …) to the form.
 */
const authRequest = async (
	path: string,
	body: Record<string, string | boolean>,
	query?: URLSearchParams,
): Promise<LegacyUser> => {
	const qs = query && query.size > 0 ? `?${query}` : "";
	const res = await fetch(`${API_BASE}${path}${qs}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json().catch(() => null)) as {
		success: boolean;
		data?: { user: LegacyUser; token: string };
		error?: string;
	} | null;
	if (!res.ok || !json?.success || !json.data) {
		// Codes like "too_many_attempts" stay on err.code; only prose is shown.
		throw new LegacyApiError(
			readableError(json?.error) ?? "Couldn't sign you in. Please try again",
			res.status,
			json ? { error: json.error } : undefined,
		);
	}
	setLegacySession(json.data.token, json.data.user);
	return json.data.user;
};

export const legacyLogin = (email: string, password: string): Promise<LegacyUser> =>
	authRequest("/auth/login", { email, password });

export interface RegisterExtras {
	/** Affiliate referral code (persisted from ?ref=). */
	ref?: string | null;
	/** Plan the visitor picked on the pricing page (?plan=). */
	plan?: string | null;
	/** Tracker visitor id from the marketing site (?rk_vid=), for the signup conversion. */
	visitorId?: string | null;
	/** Language of the page (ID/EN), so the verification email is written in it. */
	lang?: string;
	/** True when the visitor submitted the form under the "by signing up you agree" line. */
	acceptedTerms?: boolean;
}

/**
 * Register. `ref` goes in both the body and the query string: the deployed
 * worker reads `?ref=`, the newer one also accepts it in the body.
 */
export const legacyRegister = (
	name: string,
	email: string,
	password: string,
	extras: RegisterExtras = {},
): Promise<LegacyUser> => {
	const body: Record<string, string | boolean> = { name, email, password };
	const query = new URLSearchParams();
	if (extras.ref) {
		body.ref = extras.ref;
		query.set("ref", extras.ref);
	}
	if (extras.plan) {
		body.plan = extras.plan;
	}
	if (extras.visitorId) {
		body.rk_vid = extras.visitorId;
	}
	if (extras.lang) {
		body.lang = extras.lang;
	}
	if (extras.acceptedTerms) {
		body.accepted_terms = true;
	}
	return authRequest("/auth/register", body, query);
};

/**
 * Password reset, step 1. The API answers success for any address so it
 * never reveals which emails have accounts.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
	const res = await fetch(`${API_BASE}/auth/forgot-password`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email }),
	});
	if (!res.ok) {
		throw new LegacyApiError(`Request failed (${res.status})`, res.status);
	}
};

/** Password reset, step 2: trade the emailed token for a new password. */
export const resetPassword = async (token: string, password: string): Promise<void> => {
	const res = await fetch(`${API_BASE}/auth/reset-password`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token, password }),
	});
	const json = (await res.json().catch(() => null)) as
		| (LegacyErrorBody & { success?: boolean })
		| null;
	if (!res.ok || !json?.success) {
		throw new LegacyApiError(
			json?.error || `Request failed (${res.status})`,
			res.status,
			json ?? undefined,
		);
	}
};

export type VerifyEmailResult = "verified" | "invalid_token" | "expired" | "error";

/**
 * Email verification link target. The API answers {success:true}, or 400
 * with error "invalid_token" / "expired"; anything else is reported as a
 * generic failure.
 */
export const verifyEmail = async (token: string): Promise<VerifyEmailResult> => {
	try {
		const res = await fetch(`${API_BASE}/auth/verify-email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});
		const json = (await res.json().catch(() => null)) as
			| (LegacyErrorBody & { success?: boolean })
			| null;
		if (res.ok && json?.success) return "verified";
		if (json?.error === "invalid_token" || json?.error === "expired") return json.error;
		return "error";
	} catch {
		return "error";
	}
};

/** Send the verification email again. */
export const resendVerification = (): Promise<unknown> =>
	legacyFetch("/auth/resend-verification", {
		method: "POST",
		body: JSON.stringify({ lang: getLocale() }),
	});

/** Current user, fresh from the API (email_verified included when supported). */
export const fetchMe = async (): Promise<LegacyUser | null> => {
	const data = await legacyFetch<{ user?: LegacyUser }>("/auth/me");
	return data?.user ?? null;
};

const revokeSession = async (token: string): Promise<void> => {
	try {
		await fetch(`${API_BASE}/auth/logout`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch {
		// Server unreachable; the local copy is discarded regardless.
	}
};

/**
 * Sign out: delete the presented session server-side, then drop all local
 * state. By default every other account's session kept in kp_tokens is
 * revoked and forgotten too, so a shared device keeps nothing behind;
 * `keepOthers` leaves those accounts signed in for "Continue as".
 * Best-effort: local sign-out wins even if the network fails.
 */
export const legacySignOut = async ({ keepOthers = false } = {}): Promise<void> => {
	const tokens = new Set<string>();
	const current = cachedToken ?? localStorage.getItem(TOKEN_KEY);
	if (current) {
		tokens.add(current);
	}
	if (!keepOthers) {
		for (const token of listRememberedTokens(localStorage)) {
			tokens.add(token);
		}
	}
	await Promise.all([...tokens].map(revokeSession));
	if (!keepOthers) {
		clearTokenMap(localStorage);
	}
	legacyLogout();
};

export const legacyFetchEnvelope = async <T>(
	path: string,
	opts?: RequestInit,
): Promise<LegacyEnvelope<T>> => {
	const token = await getToken();
	const res = await fetch(`${API_BASE}${path}`, {
		...opts,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(opts?.headers as Record<string, string> | undefined),
		},
	});
	if (res.status === 401) {
		// Drop the (possibly revoked/expired) token; the guard sends the user to /login.
		legacyLogout();
		throw new LegacyApiError("Session expired. Sign in again", 401);
	}
	if (!res.ok) {
		// Error envelopes carry machine-readable codes (402 subscription_inactive,
		// 403 plan_required); keep them so the UI can offer an upgrade path.
		const body = (await res.json?.().catch(() => null)) as LegacyErrorBody | null | undefined;
		const readable = readableError(body?.error);
		throw new LegacyApiError(
			readable ?? `Request failed (${res.status})`,
			res.status,
			body ?? undefined,
		);
	}
	const json = (await res.json()) as LegacyEnvelope<T>;
	if (!json.success) {
		throw new LegacyApiError(json.error || "Request failed", res.status);
	}
	return json;
};

/** Raw `{ success, data, error, …siblings }` envelope, for routes that put fields next to `data`. */
export type LegacyEnvelope<T> = Record<string, unknown> & {
	success: boolean;
	data?: T;
	error?: string;
};

export const legacyFetch = async <T>(path: string, opts?: RequestInit): Promise<T> => {
	const json = await legacyFetchEnvelope<T>(path, opts);
	return json.data as T;
};

/* -------------------------------- endpoints ------------------------------- */

const rangeQuery = (p: URLSearchParams, range: string): URLSearchParams => {
	p.set("range", range);
	return p;
};

/**
 * Viewer's UTC offset in minutes, east-positive (UTC+7 → "420"), which is
 * what the worker expects. getTimezoneOffset() is west-positive, hence the
 * sign flip.
 */
export const tzParam = (date = new Date()): string => String(-date.getTimezoneOffset());

export const fetchSites = (range: string): Promise<SiteWithStats[]> =>
	legacyFetch(`/sites?${rangeQuery(new URLSearchParams(), range)}`);

export const fetchDashboard = (
	siteId: string,
	range: string,
	filters: string,
): Promise<SiteDashboard> => {
	const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
	p.set("tz", tzParam());
	if (filters) {
		p.set("filters", filters);
	}
	return legacyFetch(`/analytics/dashboard?${p}`);
};

export const fetchVisitors = (siteId: string): Promise<VisitorProfile[]> =>
	legacyFetch(`/analytics/visitors?site_id=${siteId}`);

export const fetchFunnel = (
	siteId: string,
	range: string,
	filters: string,
): Promise<ScrollFunnel> => {
	const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
	if (filters) {
		p.set("filters", filters);
	}
	return legacyFetch(`/analytics/funnel?${p}`);
};

/**
 * Campaign performance. The deployed worker predates this endpoint and
 * returns 404 — treat as "no campaigns" instead of an error.
 */
export const fetchCampaigns = async (
	siteId: string,
	range: string,
	filters: string,
): Promise<CampaignPerformance[]> => {
	const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
	p.set("tz", tzParam());
	if (filters) {
		p.set("filters", filters);
	}
	try {
		return await legacyFetch<CampaignPerformance[]>(`/analytics/campaigns?${p}`);
	} catch (error) {
		if (error instanceof LegacyApiError && error.status === 404) {
			return [];
		}
		throw error;
	}
};

export const fetchGeo = (siteId: string, range: string, filters: string): Promise<GeoRow[]> => {
	const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
	if (filters) {
		p.set("filters", filters);
	}
	return legacyFetch(`/analytics/geo?${p}`);
};

export interface CrawlerSlot {
	date: string;
	ai_answers: number;
	indexing: number;
	training: number;
	other: number;
}

export interface CrawlersResponse {
	totals: {
		all: number;
		ai_answers: number;
		indexing: number;
		training: number;
		other: number;
	};
	bots: Array<{
		bot: string;
		category: "ai_answers" | "indexing" | "training" | "other";
		count: number;
	}>;
	series: CrawlerSlot[];
}

export const fetchCrawlers = (siteId: string, range: string): Promise<CrawlersResponse> =>
	legacyFetch(`/analytics/crawlers?${rangeQuery(new URLSearchParams({ site_id: siteId }), range)}`);

export const updateVisitor = (
	id: string,
	data: Partial<Pick<VisitorProfile, "tags" | "notes" | "name" | "email">>,
): Promise<void> =>
	legacyFetch(`/analytics/visitors/${id}`, {
		body: JSON.stringify(data),
		method: "PATCH",
	});

/* --------------------------------- filters -------------------------------- */

export const encodeFilterString = (rules: LegacyFilter[]): string =>
	rules
		.filter(
			(r) => r.dimension && (r.value || r.operator === "exists" || r.operator === "not_exists"),
		)
		.map((r) => `${r.dimension}:${r.operator}:${r.value}`)
		.join(",");

/* ----------------------------------- geo ---------------------------------- */

/** City coordinates, shared with the old dashboard globe. */
export const CITY_COORDS: Record<string, [number, number]> = {
	Amsterdam: [52.37, 4.9],
	Bandung: [-6.9, 107.6],
	Bangkok: [13.75, 100.5],
	Bekasi: [-6.24, 106.99],
	Berlin: [52.52, 13.41],
	Bogor: [-6.6, 106.8],
	Denpasar: [-8.65, 115.22],
	Depok: [-6.4, 106.82],
	Dubai: [25.2, 55.27],
	Hanoi: [21.03, 105.85],
	"Ho Chi Minh City": [10.82, 106.63],
	"Hong Kong": [22.32, 114.17],
	Istanbul: [41.01, 28.98],
	Jakarta: [-6.2, 106.85],
	"Kuala Lumpur": [3.14, 101.69],
	London: [51.51, -0.13],
	"Los Angeles": [34.05, -118.24],
	Makassar: [-5.15, 119.43],
	Malang: [-7.98, 112.63],
	Manila: [14.6, 120.98],
	Medan: [3.59, 98.67],
	Melbourne: [-37.81, 144.96],
	Munich: [48.14, 11.58],
	"New York": [40.71, -74.01],
	Osaka: [34.69, 135.5],
	Palembang: [-2.99, 104.76],
	Paris: [48.86, 2.35],
	"San Francisco": [37.77, -122.42],
	"Sao Paulo": [-23.55, -46.63],
	Semarang: [-6.97, 110.42],
	Seoul: [37.57, 127],
	Singapore: [1.35, 103.82],
	Solo: [-7.57, 110.82],
	Surabaya: [-7.25, 112.75],
	Sydney: [-33.87, 151.21],
	Taipei: [25.03, 121.57],
	Tangerang: [-6.17, 106.63],
	Tokyo: [35.68, 139.69],
	Toronto: [43.65, -79.38],
	Yogyakarta: [-7.8, 110.36],
};

/** ISO-2 code → regional-indicator flag emoji. */
export const countryFlag = (code: string | null | undefined): string => {
	if (!code || code.length !== 2) {
		return "";
	}
	return String.fromCodePoint(
		...[...code.toUpperCase()].map((c) => 0x1_f1_e6 + (c.codePointAt(0) ?? 65) - 65),
	);
};

/* ----------------------------------- SSE ---------------------------------- */

export interface LiveEvent {
	type: string;
	data: unknown;
}

/** Streaming SSE reader for /analytics/stream with exponential backoff. */
const SSE_MAX_BACKOFF_MS = 30_000;

export const connectSSE = (siteId: string, onEvent: (event: LiveEvent) => void): (() => void) => {
	let aborted = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let attempt = 0;

	const schedule = (run: () => void): void => {
		const delay = Math.min(1000 * 2 ** attempt + Math.random() * 1000, SSE_MAX_BACKOFF_MS);
		attempt += 1;
		timer = setTimeout(run, delay);
	};

	const run = async (): Promise<void> => {
		timer = undefined;
		if (aborted || document.hidden) {
			return;
		}
		const token = await getToken();
		if (!token) {
			return;
		}
		try {
			const res = await fetch(`${API_BASE}/analytics/stream?site_id=${siteId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.status === 401) {
				// Dead session: retrying cannot succeed. Stop for good (the
				// visibility listener checks `aborted` too).
				aborted = true;
				return;
			}
			if (!res.ok || !res.body) {
				schedule(run);
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let eventType = "";
			try {
				for (;;) {
					// oxlint-disable-next-line no-await-in-loop -- sequential stream reads
					const { done, value } = await reader.read();
					if (done || aborted) {
						break;
					}
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) {
						if (line.startsWith("event: ")) {
							eventType = line.slice(7);
						} else if (line.startsWith("data: ")) {
							try {
								onEvent({ data: JSON.parse(line.slice(6)), type: eventType });
							} catch {
								// Malformed frame — skip.
							}
							eventType = "";
						}
					}
				}
			} finally {
				try {
					await reader.cancel();
				} catch {
					// Stream already closed.
				}
				reader.releaseLock();
			}
			attempt = 0;
		} catch {
			// Network error — backoff below.
		}
		if (!aborted) {
			schedule(run);
		}
	};

	const onVisible = (): void => {
		if (!document.hidden && !aborted && !timer) {
			attempt = 0;
			timer = setTimeout(run, 0);
		}
	};

	document.addEventListener("visibilitychange", onVisible);
	void run();

	return () => {
		aborted = true;
		if (timer) {
			clearTimeout(timer);
		}
		document.removeEventListener("visibilitychange", onVisible);
	};
};

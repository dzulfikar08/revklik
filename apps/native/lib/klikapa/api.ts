/**
 * Client for the production revklik (klikapa) Worker API.
 * Native port of apps/web/src/lib/legacy/api.ts: same endpoints, same
 * `{ success, data, error }` envelope, same LegacyApiError semantics —
 * with expo-secure-store instead of localStorage for session persistence.
 */
import { env } from "@revklik/env/native";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { AppState } from "react-native";

export const KLIKAPA_API_URL: string =
	env.EXPO_PUBLIC_KLIKAPA_API_URL ?? "https://app.revklik.com/api";
export const LEGACY_API_BASE = KLIKAPA_API_URL;

// Dev-only escape hatch: inject a pre-existing klikapa token via env instead
// of minting one. Never applied in production builds.
const ENV_TOKEN: string | undefined = __DEV__
	? process.env.EXPO_PUBLIC_KLIKAPA_API_TOKEN
	: undefined;

const TOKEN_KEY = "kp_token";
const USER_KEY = "kp_user";
const ACTIVE_SITE_KEY = "kp_active_site";

let cachedToken: string | null = null;
let cachedUser: LegacyUser | null | undefined;

const readStore = async (key: string): Promise<string | null> => {
	try {
		return await SecureStore.getItemAsync(key);
	} catch {
		// SecureStore unavailable (e.g. some web/SSR contexts) — sessionless.
		return null;
	}
};

const writeStore = async (key: string, value: string): Promise<void> => {
	try {
		await SecureStore.setItemAsync(key, value);
	} catch {
		// Persistence failed; the in-memory session still works until restart.
	}
};

const deleteStore = async (key: string): Promise<void> => {
	try {
		await SecureStore.deleteItemAsync(key);
	} catch {
		// Key already absent.
	}
};

/**
 * Session token resolution: in-memory cache → SecureStore → dev env token.
 * Returns null when signed out; callers either gate to sign-in or send the
 * request without a Bearer header.
 */
export const getToken = async (): Promise<string | null> => {
	if (cachedToken) {
		return cachedToken;
	}
	const stored = await readStore(TOKEN_KEY);
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
}

export interface SiteDashboard {
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
	revenueTimeseries: unknown[];
	channels: ChannelEntry[];
	entryPagesRevenue: EntryPageRevenue[];
	exitPages: ExitPage[];
	revenueByMethod: RevenueByPaymentMethod[];
	revenueByProvider: unknown[];
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

/** Stored klikapa profile: memory cache → SecureStore. */
export const getLegacyUser = async (): Promise<LegacyUser | null> => {
	if (cachedUser !== undefined) {
		return cachedUser;
	}
	const raw = await readStore(USER_KEY);
	if (!raw) {
		cachedUser = null;
		return null;
	}
	try {
		cachedUser = JSON.parse(raw) as LegacyUser;
	} catch {
		cachedUser = null;
	}
	return cachedUser;
};

/** Drop the cached klikapa token + profile (sign-out or 401 recovery). */
export const legacyLogout = (): void => {
	cachedToken = null;
	cachedUser = undefined;
	void deleteStore(TOKEN_KEY);
	void deleteStore(USER_KEY);
	void deleteStore(ACTIVE_SITE_KEY);
};

export class LegacyApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "LegacyApiError";
		this.status = status;
	}
}

/**
 * Shared email/password auth: POST to a klikapa auth endpoint, persist the
 * returned session token + user, and surface the API's error message
 * ("Invalid credentials", "Email taken", …) to the form.
 */
const authRequest = async (path: string, body: Record<string, string>): Promise<LegacyUser> => {
	const res = await fetch(`${KLIKAPA_API_URL}${path}`, {
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	const json = (await res.json().catch(() => null)) as {
		success: boolean;
		data?: { user: LegacyUser; token: string };
		error?: string;
	} | null;
	if (!res.ok || !json?.success || !json.data) {
		throw new LegacyApiError(json?.error || "Couldn't sign you in — please try again", res.status);
	}
	cachedToken = json.data.token;
	cachedUser = json.data.user;
	await writeStore(TOKEN_KEY, json.data.token);
	await writeStore(USER_KEY, JSON.stringify(json.data.user));
	return json.data.user;
};

export const legacyLogin = (email: string, password: string): Promise<LegacyUser> =>
	authRequest("/auth/login", { email, password });

export const legacyRegister = (
	name: string,
	email: string,
	password: string,
): Promise<LegacyUser> => authRequest("/auth/register", { email, name, password });

/**
 * Start URL for the klikapa Google OAuth flow.
 *
 * BLOCKED server-side (do not hack around): the production worker's
 * `/auth/google` hard-redirects back to the web app (`/#token=…` on the
 * revklik web origin), so an in-app browser session can never hand the
 * token to this app. The worker needs a client-supplied post-auth redirect
 * — e.g. honor `?redirect_to=<urlencoded app callback>` on GET /auth/google
 * or add a native OAuth entry that 302s to the app scheme
 * `revklik-new://auth/callback#token=…`. Until then Google sign-in stays
 * web-only; see components/sign-in.tsx for the capture attempt that lights
 * up automatically once the redirect exists.
 */
export const GOOGLE_AUTH_URL = `${KLIKAPA_API_URL}/auth/google`;

/**
 * Complete a Google OAuth flow that landed back in the app with
 * `#token=<session>` in the callback URL (mirrors the web root route):
 * resolve the profile via GET /auth/me, then persist token + user.
 */
export const completeGoogleSignIn = async (token: string): Promise<LegacyUser> => {
	const res = await fetch(`${KLIKAPA_API_URL}/auth/me`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const json = (await res.json().catch(() => null)) as {
		success: boolean;
		data?: { user?: LegacyUser };
	} | null;
	const user = json?.data?.user;
	if (!res.ok || !json?.success || !user) {
		throw new LegacyApiError("Couldn't complete Google sign-in — please try again", res.status);
	}
	cachedToken = token;
	cachedUser = user;
	await writeStore(TOKEN_KEY, token);
	await writeStore(USER_KEY, JSON.stringify(user));
	return user;
};

/**
 * Sign out: delete the presented session server-side, then drop all local
 * state. Best-effort — local sign-out wins even if the network fails.
 */
export const legacySignOut = async (): Promise<void> => {
	const token = cachedToken ?? (await readStore(TOKEN_KEY));
	if (token) {
		try {
			await fetch(`${KLIKAPA_API_URL}/auth/logout`, {
				headers: { Authorization: `Bearer ${token}` },
				method: "POST",
			});
		} catch {
			// Server unreachable; the local session is discarded regardless.
		}
	}
	legacyLogout();
};
export const legacyFetch = async <T>(path: string, opts?: RequestInit): Promise<T> => {
	const token = await getToken();
	const res = await fetch(`${KLIKAPA_API_URL}${path}`, {
		...opts,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(opts?.headers as Record<string, string> | undefined),
		},
	});
	if (res.status === 401) {
		// Drop the (possibly revoked/expired) token; the auth gate signs out.
		legacyLogout();
		throw new LegacyApiError("Session expired — sign in again", 401);
	}
	if (!res.ok) {
		throw new LegacyApiError(`Request failed (${res.status})`, res.status);
	}
	const json = (await res.json()) as {
		success: boolean;
		data?: T;
		error?: string;
	};
	if (!json.success) {
		throw new LegacyApiError(json.error || "Request failed", res.status);
	}
	return json.data as T;
};

/* ------------------------------ active site ------------------------------- */

/** Last site the user viewed — restored on cold start, like the web app. */
export const getActiveSiteId = (): Promise<string | null> => readStore(ACTIVE_SITE_KEY);

export const setActiveSiteId = (siteId: string): Promise<void> =>
	writeStore(ACTIVE_SITE_KEY, siteId);

/* -------------------------------- endpoints ------------------------------- */

const rangeQuery = (p: URLSearchParams, range: string): URLSearchParams => {
	p.set("range", range);
	return p;
};

export const fetchSites = (range: string): Promise<SiteWithStats[]> =>
	legacyFetch(`/sites?${rangeQuery(new URLSearchParams(), range)}`);

export const fetchDashboard = (
	siteId: string,
	range: string,
	filters: string,
): Promise<SiteDashboard> => {
	const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
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

/**
 * Streaming SSE reader for /analytics/stream with exponential backoff.
 * Uses expo/fetch (WinterCG fetch with streaming response bodies) — the
 * stock RN fetch cannot read partial bodies. AppState replaces
 * document.visibilitychange: the stream pauses while backgrounded.
 */
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
		if (aborted) {
			return;
		}
		const token = await getToken();
		if (!token) {
			return;
		}
		try {
			const res = await expoFetch(`${KLIKAPA_API_URL}/analytics/stream?site_id=${siteId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
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
			// Network error or streaming unsupported — backoff below.
		}
		if (!aborted) {
			schedule(run);
		}
	};

	const sub = AppState.addEventListener("change", (state) => {
		if (state === "active" && !aborted && !timer) {
			attempt = 0;
			timer = setTimeout(run, 0);
		}
	});

	run();

	return () => {
		aborted = true;
		if (timer) {
			clearTimeout(timer);
		}
		sub.remove();
	};
};

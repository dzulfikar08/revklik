/**
 * Client for the production revklik (klikapa) Worker API.
 *
 * The analytics UI reads live data from the deployed backend at
 * app.revklik.com — same D1 (klikapa-db), same routes the old dashboard
 * uses. Auth is the legacy session token (`kp_token`) from /auth/login,
 * sent as a Bearer header. Responses use the `{ success, data, error }`
 * envelope.
 */

const API_BASE: string =
  import.meta.env.VITE_LEGACY_API_BASE ?? "https://app.revklik.com/api";
export const LEGACY_API_BASE = API_BASE;

const ENV_TOKEN: string | undefined = import.meta.env.VITE_LEGACY_API_TOKEN;

const TOKEN_KEY = "kp_token";
const USER_KEY = "kp_user";

/** Session token: localStorage first, then the dev env token. */
export const getToken = (): string | null =>
  localStorage.getItem(TOKEN_KEY) ?? ENV_TOKEN ?? null;

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

export const isLegacyAuthed = (): boolean => Boolean(getToken());

export const getLegacyUser = (): LegacyUser | null => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as LegacyUser) : null;
  } catch {
    return null;
  }
};

export const legacyLogout = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("kp_active_site");
};

export class LegacyApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LegacyApiError";
    this.status = status;
  }
}

export const legacyFetch = async <T>(path: string, opts?: RequestInit): Promise<T> => {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401) {
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

export const legacyLogin = async (
  email: string,
  password: string
): Promise<LegacyUser> => {
  const data = await legacyFetch<{ user: LegacyUser; token: string }>(
    "/auth/login",
    { body: JSON.stringify({ email, password }), method: "POST" }
  );
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
};

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
  filters: string
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
  filters: string
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
  filters: string
): Promise<CampaignPerformance[]> => {
  const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
  if (filters) {
    p.set("filters", filters);
  }
  try {
    return await legacyFetch<CampaignPerformance[]>(
      `/analytics/campaigns?${p}`
    );
  } catch (error) {
    if (error instanceof LegacyApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
};

export const fetchGeo = (
  siteId: string,
  range: string,
  filters: string
): Promise<GeoRow[]> => {
  const p = rangeQuery(new URLSearchParams({ site_id: siteId }), range);
  if (filters) {
    p.set("filters", filters);
  }
  return legacyFetch(`/analytics/geo?${p}`);
};

export const updateVisitor = (
  id: string,
  data: Partial<Pick<VisitorProfile, "tags" | "notes" | "name" | "email">>
): Promise<void> =>
  legacyFetch(`/analytics/visitors/${id}`, {
    body: JSON.stringify(data),
    method: "PATCH",
  });

/* --------------------------------- filters -------------------------------- */

export const encodeFilterString = (rules: LegacyFilter[]): string =>
  rules
    .filter(
      (r) =>
        r.dimension &&
        (r.value || r.operator === "exists" || r.operator === "not_exists")
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
    ...[...code.toUpperCase()].map(
      (c) => 0x1_f1_e6 + (c.codePointAt(0) ?? 65) - 65
    )
  );
};

/* ----------------------------------- SSE ---------------------------------- */

export interface LiveEvent {
  type: string;
  data: unknown;
}

/** Streaming SSE reader for /analytics/stream with exponential backoff. */
const SSE_MAX_BACKOFF_MS = 30_000;

export const connectSSE = (
  siteId: string,
  onEvent: (event: LiveEvent) => void
): (() => void) => {
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const schedule = (run: () => void): void => {
    const delay = Math.min(
      1000 * 2 ** attempt + Math.random() * 1000,
      SSE_MAX_BACKOFF_MS
    );
    attempt += 1;
    timer = setTimeout(run, delay);
  };

  const run = async (): Promise<void> => {
    timer = undefined;
    if (aborted || document.hidden) {
      return;
    }
    const token = getToken();
    if (!token) {
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/analytics/stream?site_id=${siteId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
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

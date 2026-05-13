export type { KlikapaDatabase, EventTable, SessionTable, SiteTable, UserTable, ApiKeyTable, VisitorProfileTable } from "./database";

export interface TrackEventPayload {
  s: string;
  sid: string;
  vid: string;
  t: "p" | "c" | "e";
  n?: string;
  p: string;
  h?: string;
  r?: string;
  us?: string;
  um?: string;
  uc?: string;
  ut?: string;
  uco?: string;
  rv?: number;
  pr?: Record<string, string>;
}

export interface IdentifyPayload {
  s: string;
  vid: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

export interface StatsResponse {
  pageviews: number;
  visitors: number;
  sessions: number;
  bounceRate: number;
  avgDuration: number;
  revenue: number;
  conversions: number;
}

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

export interface JourneyStep {
  path: string;
  event_type: string;
  name: string | null;
  timestamp: string;
  revenue: number | null;
}

export interface VisitorJourney {
  session_id: string;
  visitor_id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  country: string | null;
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

export interface Site {
  id: string;
  name: string;
  domain: string;
  created_at: string;
}

export interface SiteWithStats extends Site {
  pageviews: number;
  visitors: number;
  sparkline: number[];
  revenue: number;
}

export interface SiteDashboard {
  stats: StatsResponse;
  timeseries: TimeSeriesPoint[];
  topPages: TopPage[];
  sources: SourceEntry[];
  journeys: VisitorJourney[];
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

export interface CreateSitePayload {
  name: string;
  domain: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: { id: string; name: string; email: string };
  token: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  success: boolean;
}

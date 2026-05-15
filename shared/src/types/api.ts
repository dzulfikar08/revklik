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
  ts?: number;
  dv?: string;
  br?: string;
  os?: string;
  sr?: string;
  ln?: string;
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

export interface DeviceEntry {
  device: string;
  visitors: number;
  percentage: number;
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

export interface RevenueTimeSeriesPoint {
  date: string;
  revenue: number;
  conversions: number;
}

export interface SiteDashboard {
  stats: StatsResponse;
  timeseries: TimeSeriesPoint[];
  topPages: TopPage[];
  sources: SourceEntry[];
  devices: DeviceEntry[];
  os: DeviceEntry[];
  browsers: DeviceEntry[];
  journeys: VisitorJourney[];
  revenueBySource: RevenueBySource[];
  revenueByCountry: RevenueByCountry[];
  revenueTimeseries: RevenueTimeSeriesPoint[];
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

export interface FunnelStep {
  section: string;
  visitors: number;
  percentage: number;
  dropoff: number;
}

export interface PageFunnel {
  path: string;
  steps: FunnelStep[];
  totalVisitors: number;
  conversionRate: number;
}

export interface ScrollFunnel {
  steps: FunnelStep[];
  totalVisitors: number;
  conversionRate: number;
  pages: PageFunnel[];
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

// Heatmap types
export interface HeatmapData {
  clickGrid: number[][];
  scrollDepths: { depth: number; visitors: number }[];
  totalSessions: number;
  totalClicks: number;
  topElements: { selector: string; clicks: number; label: string }[];
}

export interface RecordingSummary {
  id: string;
  session_id: string;
  path: string;
  duration: number;
  viewport_width: number | null;
  started_at: string;
  event_count: number;
  has_revenue: boolean;
}

export interface RecordingDetail extends RecordingSummary {
  events: Array<{
    t: number;
    type: "mutation" | "interaction" | "scroll" | "resize";
    d: unknown;
  }>;
  viewport_height: number | null;
}

// Integration types
export type IntegrationType = "mailchimp" | "convertkit" | "kit" | "beehiiv" | "meta_ads" | "google_ads";

export interface Integration {
  id: string;
  site_id: string;
  type: IntegrationType;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  last_sync: string | null;
  created_at: string;
}

export interface CreateIntegrationPayload {
  site_id: string;
  type: IntegrationType;
  name: string;
  config: Record<string, string>;
}

export interface WebhookEventLog {
  id: string;
  integration_id: string;
  direction: "inbound" | "outbound";
  event_type: string;
  status: "pending" | "processed" | "failed";
  created_at: string;
}

// AI Insights types
export type InsightType = "revenue_drivers" | "geo_opportunities" | "funnel_optimization" | "traffic_roi";

export interface AiInsight {
  id: string;
  type: InsightType;
  title: string;
  summary: string;
  detail: string;
  confidence: number;
  action: string | null;
}

export interface InsightsResponse {
  insights: AiInsight[];
  generated_at: string;
  data_summary: {
    total_events: number;
    total_revenue: number;
    date_range: string;
  };
}

// Subscription/billing types
export type PlanTier = "free" | "starter" | "growth";

export interface Subscription {
  id: string;
  user_id: string;
  plan: PlanTier;
  status: "active" | "canceled" | "past_due" | "trialing";
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  polar_subscription_id: string | null;
  polar_customer_id: string | null;
}

export interface CheckoutSession {
  url: string;
}

export interface PlanInfo {
  tier: PlanTier;
  name: string;
  price: number;
  events_per_month: number;
  sites: number;
  features: string[];
  checkout_url: string | null;
}

// Public API v1 types
export const SCOPES = {
  SITES_READ: "sites:read",
  ANALYTICS_READ: "analytics:read",
  ANALYTICS_EXPORT: "analytics:export",
  TOKENS_READ: "tokens:read",
  TOKENS_WRITE: "tokens:write",
} as const;

export const DEFAULT_ACCOUNT_SCOPES = [
  SCOPES.SITES_READ,
  SCOPES.ANALYTICS_READ,
  SCOPES.ANALYTICS_EXPORT,
  SCOPES.TOKENS_READ,
  SCOPES.TOKENS_WRITE,
];

export const DEFAULT_SITE_SCOPES = [
  SCOPES.ANALYTICS_READ,
  SCOPES.ANALYTICS_EXPORT,
];

export interface WhoamiResponse {
  user: { id: string; name: string; email: string };
  plan: string;
  token: {
    type: "account" | "site";
    scopes: string[];
    site_id: string | null;
    name: string;
    created_at: string;
  };
}

export interface CreateTokenRequest {
  name: string;
  type: "account" | "site";
  scopes?: string[];
  site_id?: string;
}

export interface CreateTokenResponse {
  id: string;
  token: string;
  prefix: string;
  name: string;
  type: "account" | "site";
  scopes: string[];
  site_id: string | null;
  created_at: string;
}

export interface TokenInfo {
  id: string;
  prefix: string;
  name: string;
  type: "account" | "site";
  scopes: string[];
  site_id: string | null;
  last_used_at: string | null;
  created_at: string;
}

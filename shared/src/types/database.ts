export interface EventTable {
  id: string;
  site_id: string;
  session_id: string;
  visitor_id: string;
  timestamp: string;
  event_type: "pageview" | "custom" | "conversion";
  name: string | null;
  path: string;
  hostname: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  revenue: number | null;
  props: string | null;
  fingerprint: string | null;
}

export interface SessionTable {
  id: string;
  site_id: string;
  visitor_id: string;
  started_at: string;
  ended_at: string | null;
  entry_path: string | null;
  exit_path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  page_count: number;
  is_bounce: number;
  fingerprint: string | null;
}

export interface SiteTable {
  id: string;
  user_id: string;
  name: string;
  domain: string;
  created_at: string;
}

export interface UserTable {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
}

export interface ApiKeyTable {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  created_at: string;
}

export interface VisitorProfileTable {
  id: string;
  site_id: string;
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
  fingerprint: string | null;
}

export interface KlikapaDatabase {
  events: EventTable;
  sessions: SessionTable;
  sites: SiteTable;
  users: UserTable;
  api_keys: ApiKeyTable;
  visitor_profiles: VisitorProfileTable;
  heatmap_clicks: HeatmapClickTable;
  heatmap_scrolls: HeatmapScrollTable;
  session_recordings: SessionRecordingTable;
  heatmap_aggregates: HeatmapAggregateTable;
  integrations: IntegrationTable;
  webhook_events: WebhookEventTable;
  ai_insights: AiInsightTable;
  subscriptions: SubscriptionTable;
  team_members: TeamMemberTable;
  push_tokens: PushTokenTable;
}

export interface HeatmapClickTable {
  id: string;
  site_id: string;
  session_id: string;
  visitor_id: string;
  path: string;
  x: number;
  y: number;
  element_selector: string | null;
  element_text: string | null;
  viewport_width: number | null;
  timestamp: string;
}

export interface HeatmapScrollTable {
  id: string;
  site_id: string;
  session_id: string;
  visitor_id: string;
  path: string;
  max_scroll: number;
  viewport_height: number | null;
  doc_height: number | null;
  timestamp: string;
}

export interface SessionRecordingTable {
  id: string;
  site_id: string;
  session_id: string;
  visitor_id: string;
  path: string;
  events: string;
  duration: number;
  viewport_width: number | null;
  viewport_height: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface HeatmapAggregateTable {
  id: string;
  site_id: string;
  path: string;
  period: string;
  click_grid: string;
  scroll_depths: string;
  total_sessions: number;
  total_clicks: number;
  updated_at: string;
}

export interface IntegrationTable {
  id: string;
  site_id: string;
  user_id: string;
  type: string;
  name: string;
  config: string;
  enabled: number;
  last_sync: string | null;
  created_at: string;
}

export interface WebhookEventTable {
  id: string;
  site_id: string;
  integration_id: string;
  direction: string;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  created_at: string;
  processed_at: string | null;
}

export interface AiInsightTable {
  id: string;
  site_id: string;
  range: string;
  insight_type: string;
  insight_text: string;
  data_refs: string | null;
  confidence: number;
  created_at: string;
  expires_at: string;
}

export interface SubscriptionTable {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: number;
  polar_subscription_id: string | null;
  polar_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberTable {
  id: string;
  site_id: string;
  user_id: string;
  role: string;
  invited_by: string;
  invited_at: string;
  accepted_at: string | null;
}

export interface PushTokenTable {
  id: string;
  user_id: string;
  device_token: string;
  platform: string;
  created_at: string;
}

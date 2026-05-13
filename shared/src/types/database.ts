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
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  revenue: number | null;
  props: string | null;
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
  device_type: string | null;
  browser: string | null;
  os: string | null;
  page_count: number;
  is_bounce: number;
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

export interface KlikapaDatabase {
  events: EventTable;
  sessions: SessionTable;
  sites: SiteTable;
  users: UserTable;
  api_keys: ApiKeyTable;
  visitor_profiles: VisitorProfileTable;
}

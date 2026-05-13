let migrationRan = false;

export async function migrateDatabase(d1: D1Database): Promise<void> {
  if (migrationRan) return;

  try {
    await d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'default', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, props TEXT)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, avatar TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), country TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, total_sessions INTEGER NOT NULL DEFAULT 0, total_pageviews INTEGER NOT NULL DEFAULT 0, total_revenue REAL NOT NULL DEFAULT 0, tags TEXT, notes TEXT)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_site_visitor ON visitor_profiles(site_id, visitor_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_time ON events(site_id, timestamp)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_session ON events(site_id, session_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_visitor ON events(site_id, visitor_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_type ON events(site_id, event_type, timestamp)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id, started_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(site_id, visitor_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)"),
    ]);
  } catch {
    // tables may already exist
  }

  try {
    await d1.prepare("SELECT user_id FROM sites LIMIT 1").all();
  } catch {
    await d1.batch([
      d1.prepare("DROP TABLE IF EXISTS sites"),
      d1.prepare("CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id)"),
    ]);
  }

  migrationRan = true;
}

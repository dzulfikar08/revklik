let migrationRan = false;

export async function migrateDatabase(d1: D1Database): Promise<void> {
  if (migrationRan) return;

  try {
    await d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'default', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, props TEXT)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, avatar TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, total_sessions INTEGER NOT NULL DEFAULT 0, total_pageviews INTEGER NOT NULL DEFAULT 0, total_revenue REAL NOT NULL DEFAULT 0, tags TEXT, notes TEXT)"),
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

  // Migrate: add region and city columns to existing tables
  const alterStatements = [
    "ALTER TABLE events ADD COLUMN region TEXT",
    "ALTER TABLE sessions ADD COLUMN region TEXT",
    "ALTER TABLE sessions ADD COLUMN city TEXT",
    "ALTER TABLE visitor_profiles ADD COLUMN region TEXT",
  ];
  for (const stmt of alterStatements) {
    try { await d1.prepare(stmt).run(); } catch { /* column may already exist */ }
  }

  // Migrate: add missing indexes for query performance
  const indexStatements = [
    "CREATE INDEX IF NOT EXISTS idx_events_site_name_time ON events(site_id, name, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_events_site_path ON events(site_id, path)",
    "CREATE INDEX IF NOT EXISTS idx_vp_site_last_seen ON visitor_profiles(site_id, last_seen)",
  ];
  for (const stmt of indexStatements) {
    try { await d1.prepare(stmt).run(); } catch { /* index may already exist */ }
  }

  // Migrate: add fingerprint column for cookieless attribution
  const fingerprintStatements = [
    "ALTER TABLE events ADD COLUMN fingerprint TEXT",
    "ALTER TABLE sessions ADD COLUMN fingerprint TEXT",
    "ALTER TABLE visitor_profiles ADD COLUMN fingerprint TEXT",
  ];
  for (const stmt of fingerprintStatements) {
    try { await d1.prepare(stmt).run(); } catch { /* column may already exist */ }
  }
  const fingerprintIndexes = [
    "CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON events(site_id, fingerprint)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_fingerprint ON sessions(site_id, fingerprint)",
    "CREATE INDEX IF NOT EXISTS idx_vp_fingerprint ON visitor_profiles(site_id, fingerprint)",
  ];
  for (const stmt of fingerprintIndexes) {
    try { await d1.prepare(stmt).run(); } catch { /* index may already exist */ }
  }

  // Heatmap click data
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS heatmap_clicks (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      element_selector TEXT,
      element_text TEXT,
      viewport_width INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await d1.batch([
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_hmc_site_path ON heatmap_clicks(site_id, path, timestamp)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_hmc_site_time ON heatmap_clicks(site_id, timestamp)"),
    ]);
  } catch { /* table may already exist */ }

  // Heatmap scroll data
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS heatmap_scrolls (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      max_scroll REAL NOT NULL,
      viewport_height INTEGER,
      doc_height INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await d1.prepare("CREATE INDEX IF NOT EXISTS idx_hms_site_path ON heatmap_scrolls(site_id, path, timestamp)").run();
  } catch { /* table may already exist */ }

  // Session recordings
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS session_recordings (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      events TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      viewport_width INTEGER,
      viewport_height INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    )`).run();
    await d1.batch([
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_sr_site ON session_recordings(site_id, started_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_sr_session ON session_recordings(session_id)"),
    ]);
  } catch { /* table may already exist */ }

  // Aggregated heatmap data
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS heatmap_aggregates (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      path TEXT NOT NULL,
      period TEXT NOT NULL,
      click_grid TEXT NOT NULL,
      scroll_depths TEXT NOT NULL,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      total_clicks INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_hma_site_path_period ON heatmap_aggregates(site_id, path, period)").run();
  } catch { /* table may already exist */ }

  // Integrations
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await d1.batch([
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_int_site ON integrations(site_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_int_user ON integrations(user_id)"),
    ]);
  } catch { /* table may already exist */ }

  // Webhook events log
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`).run();
    await d1.batch([
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_site ON webhook_events(site_id, created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_status ON webhook_events(status, created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_int ON webhook_events(integration_id)"),
    ]);
  } catch { /* table may already exist */ }

  // AI insights cache
  try {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      range TEXT NOT NULL,
      insight_type TEXT NOT NULL,
      insight_text TEXT NOT NULL,
      data_refs TEXT,
      confidence REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )`).run();
    await d1.batch([
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_ai_site ON ai_insights(site_id, range, insight_type)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS idx_ai_expires ON ai_insights(expires_at)"),
    ]);
  } catch { /* table may already exist */ }

  migrationRan = true;
}

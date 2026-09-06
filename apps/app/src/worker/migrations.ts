let migrationRan = false;

/** True once migrateDatabase has completed successfully on this isolate. */
export const hasMigrated = (): boolean => migrationRan;

export async function migrateDatabase(d1: D1Database): Promise<void> {
	if (migrationRan) return;

	try {
		await d1.batch([
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'default', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, props TEXT)",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1)",
			),
			d1.prepare(
				"CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, avatar TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, total_sessions INTEGER NOT NULL DEFAULT 0, total_pageviews INTEGER NOT NULL DEFAULT 0, total_revenue REAL NOT NULL DEFAULT 0, tags TEXT, notes TEXT)",
			),
			d1.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_site_visitor ON visitor_profiles(site_id, visitor_id)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_time ON events(site_id, timestamp)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_session ON events(site_id, session_id)",
			),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_visitor ON events(site_id, visitor_id)",
			),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_type ON events(site_id, event_type, timestamp)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id, started_at)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(site_id, visitor_id)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)"),
		]);
	} catch {
		// tables may already exist
	}

	try {
		await d1.prepare("SELECT user_id FROM sites LIMIT 1").all();
	} catch {
		// The SELECT can fail transiently (or because the DB is briefly
		// unreachable) — never drop a table because of it. Only create the
		// table when it genuinely does not exist.
		try {
			const sitesTable = await d1
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites'")
				.first();
			if (!sitesTable) {
				await d1.batch([
					d1.prepare(
						"CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
					),
					d1.prepare("CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id)"),
				]);
			}
		} catch (err) {
			console.error("sites table bootstrap skipped:", err);
		}
	}

	// Migrate: add region and city columns to existing tables
	const alterStatements = [
		"ALTER TABLE events ADD COLUMN region TEXT",
		"ALTER TABLE sessions ADD COLUMN region TEXT",
		"ALTER TABLE sessions ADD COLUMN city TEXT",
		"ALTER TABLE visitor_profiles ADD COLUMN region TEXT",
	];
	for (const stmt of alterStatements) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}

	// Migrate: add missing indexes for query performance
	const indexStatements = [
		"CREATE INDEX IF NOT EXISTS idx_events_site_name_time ON events(site_id, name, timestamp)",
		"CREATE INDEX IF NOT EXISTS idx_events_site_path ON events(site_id, path)",
		"CREATE INDEX IF NOT EXISTS idx_vp_site_last_seen ON visitor_profiles(site_id, last_seen)",
	];
	for (const stmt of indexStatements) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* index may already exist */
		}
	}

	// Migrate: add fingerprint column for cookieless attribution
	const fingerprintStatements = [
		"ALTER TABLE events ADD COLUMN fingerprint TEXT",
		"ALTER TABLE sessions ADD COLUMN fingerprint TEXT",
		"ALTER TABLE visitor_profiles ADD COLUMN fingerprint TEXT",
	];
	for (const stmt of fingerprintStatements) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	const fingerprintIndexes = [
		"CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON events(site_id, fingerprint)",
		"CREATE INDEX IF NOT EXISTS idx_sessions_fingerprint ON sessions(site_id, fingerprint)",
		"CREATE INDEX IF NOT EXISTS idx_vp_fingerprint ON visitor_profiles(site_id, fingerprint)",
	];
	for (const stmt of fingerprintIndexes) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* index may already exist */
		}
	}

	// Heatmap click data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS heatmap_clicks (
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
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_hmc_site_path ON heatmap_clicks(site_id, path, timestamp)",
			),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_hmc_site_time ON heatmap_clicks(site_id, timestamp)",
			),
		]);
	} catch {
		/* table may already exist */
	}

	// Heatmap scroll data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS heatmap_scrolls (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      path TEXT NOT NULL,
      max_scroll REAL NOT NULL,
      viewport_height INTEGER,
      doc_height INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_hms_site_path ON heatmap_scrolls(site_id, path, timestamp)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Session recordings
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS session_recordings (
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
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_sr_site ON session_recordings(site_id, started_at)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_sr_session ON session_recordings(session_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Aggregated heatmap data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS heatmap_aggregates (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      path TEXT NOT NULL,
      period TEXT NOT NULL,
      click_grid TEXT NOT NULL,
      scroll_depths TEXT NOT NULL,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      total_clicks INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_hma_site_path_period ON heatmap_aggregates(site_id, path, period)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Integrations
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_int_site ON integrations(site_id)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_int_user ON integrations(user_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Webhook events log
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (
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
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_site ON webhook_events(site_id, created_at)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_status ON webhook_events(status, created_at)"),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_we_int ON webhook_events(integration_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// AI insights cache
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      range TEXT NOT NULL,
      insight_type TEXT NOT NULL,
      insight_text TEXT NOT NULL,
      data_refs TEXT,
      confidence REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_ai_site ON ai_insights(site_id, range, insight_type)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_ai_expires ON ai_insights(expires_at)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Subscriptions
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TEXT NOT NULL DEFAULT (datetime('now')),
      current_period_end TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      polar_subscription_id TEXT,
      polar_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id)"),
			d1.prepare(
				"CREATE INDEX IF NOT EXISTS idx_sub_polar ON subscriptions(polar_subscription_id)",
			),
		]);
	} catch {
		/* table may already exist */
	}

	// Migrate: pakasir_order_id for QRIS checkout verification
	try {
		await d1.prepare("ALTER TABLE subscriptions ADD COLUMN pakasir_order_id TEXT").run();
	} catch {
		/* column may already exist */
	}

	// Team members
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      invited_by TEXT NOT NULL,
      invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT
    )`)
			.run();
		await d1.batch([
			d1.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_site_user ON team_members(site_id, user_id)",
			),
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Migrate: add google_id, avatar_url, role to users
	for (const stmt of [
		"ALTER TABLE users ADD COLUMN google_id TEXT",
		"ALTER TABLE users ADD COLUMN avatar_url TEXT",
		"ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	try {
		await d1
			.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id)")
			.run();
	} catch {
		/* index may already exist */
	}

	// Push tokens for mobile notifications
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.batch([
			d1.prepare("CREATE INDEX IF NOT EXISTS idx_pt_user ON push_tokens(user_id)"),
			d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pt_token ON push_tokens(device_token)"),
		]);
	} catch {
		/* table may already exist */
	}

	// Revenue analytics index for fast revenue breakdown queries
	try {
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_revenue_time ON events(site_id, revenue, timestamp)",
			)
			.run();
	} catch {
		/* index may already exist */
	}

	// Public API: extend api_keys with token types, scopes, site binding, usage tracking
	for (const stmt of [
		"ALTER TABLE api_keys ADD COLUMN token_type TEXT NOT NULL DEFAULT 'session'",
		"ALTER TABLE api_keys ADD COLUMN scopes TEXT",
		"ALTER TABLE api_keys ADD COLUMN site_id TEXT",
		"ALTER TABLE api_keys ADD COLUMN last_used_at TEXT",
		"ALTER TABLE api_keys ADD COLUMN expires_at TEXT",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	try {
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(user_id, token_type)")
			.run();
	} catch {
		/* index may already exist */
	}

	// Payment provider configurations per site
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS payment_providers (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_pp_site ON payment_providers(site_id)").run();
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_pp_site_provider ON payment_providers(site_id, provider)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Webhook delivery log for payment providers
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_wl_site ON webhook_logs(site_id)").run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_wl_site_provider ON webhook_logs(site_id, provider)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Saved segments
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_segments_site ON segments(site_id)").run();
	} catch {
		/* table may already exist */
	}

	// Chart annotations
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      date TEXT NOT NULL,
      text TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_annotations_site ON annotations(site_id, date)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Email reports config
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS email_reports (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'weekly',
      enabled INTEGER DEFAULT 1,
      last_sent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_er_site ON email_reports(site_id)").run();
	} catch {
		/* table may already exist */
	}

	// Payment-related columns on events and sites
	for (const stmt of [
		"ALTER TABLE events ADD COLUMN payment_provider TEXT",
		"ALTER TABLE events ADD COLUMN payment_method TEXT",
		"ALTER TABLE events ADD COLUMN currency TEXT DEFAULT 'USD'",
		"ALTER TABLE events ADD COLUMN subscription_id TEXT",
		"ALTER TABLE sites ADD COLUMN share_token TEXT",
		"ALTER TABLE sites ADD COLUMN public_dashboard INTEGER DEFAULT 0",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	try {
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_events_site_payment ON events(site_id, payment_provider, payment_method, timestamp)",
			)
			.run();
	} catch {
		/* index may already exist */
	}

	// Backfill payment columns from webhook props (handlers wrote JSON-only before columns existed)
	for (const stmt of [
		`UPDATE events
		 SET payment_provider = REPLACE(json_extract(props, '$.source'), '_webhook', '')
		 WHERE payment_provider IS NULL
		 AND revenue > 0
		 AND json_extract(props, '$.source') IS NOT NULL`,
		`UPDATE events
		 SET payment_method = json_extract(props, '$.payment_method')
		 WHERE payment_method IS NULL
		 AND json_extract(props, '$.payment_method') IS NOT NULL`,
		`UPDATE events
		 SET currency = json_extract(props, '$.currency')
		 WHERE currency IS NULL
		 AND json_extract(props, '$.currency') IS NOT NULL`,
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* props may be invalid JSON */
		}
	}

	// Search Console data
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS search_console_data (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      date TEXT NOT NULL,
      query TEXT NOT NULL,
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr REAL DEFAULT 0,
      position REAL DEFAULT 0,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_scd_site_date ON search_console_data(site_id, date)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Marketplace orders
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      order_id TEXT NOT NULL,
      order_sn TEXT NOT NULL,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'IDR',
      status TEXT DEFAULT 'pending',
      buyer_info TEXT,
      items TEXT,
      ordered_at TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_unique ON marketplace_orders(site_id, marketplace, order_sn)",
			)
			.run();
		await d1
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_mo_site ON marketplace_orders(site_id, marketplace, ordered_at)",
			)
			.run();
	} catch {
		/* table may already exist */
	}

	// Affiliates
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS affiliates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      referral_code TEXT NOT NULL UNIQUE,
      commission_rate REAL DEFAULT 0.2,
      total_earned REAL DEFAULT 0,
      total_paid REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_aff_user ON affiliates(user_id)").run();
		await d1.prepare("CREATE INDEX IF NOT EXISTS idx_aff_code ON affiliates(referral_code)").run();
	} catch {
		/* table may already exist */
	}

	// Referrals
	try {
		await d1
			.prepare(`CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT 'signup',
      commission_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_ref_affiliate ON referrals(affiliate_id)")
			.run();
		await d1
			.prepare("CREATE INDEX IF NOT EXISTS idx_ref_user ON referrals(referred_user_id)")
			.run();
	} catch {
		/* table may already exist */
	}

	// Self-traffic exclusion: per-site fingerprint blocklist (JSON text array)
	for (const stmt of ["ALTER TABLE sites ADD COLUMN excluded_fingerprints TEXT"]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}

	// Embeddable live-stats widget (per-site opt-in + opaque token + tz offset for "today")
	for (const stmt of [
		"ALTER TABLE sites ADD COLUMN widget_enabled INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE sites ADD COLUMN widget_token TEXT",
		"ALTER TABLE sites ADD COLUMN widget_tz_offset INTEGER NOT NULL DEFAULT 0",
	]) {
		try {
			await d1.prepare(stmt).run();
		} catch {
			/* column may already exist */
		}
	}
	migrationRan = true;
}

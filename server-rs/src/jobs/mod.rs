use sqlx::PgPool;
use std::time::Duration;

/// Try to acquire a session-level advisory lock keyed by a stable hash of `name`.
/// Returns true if acquired (caller holds it for the task lifetime). Ensures only one
/// instance runs a given periodic job across multi-instance deployments.
async fn try_advisory_lock(db: &PgPool, name: &str) -> bool {
    let key = hash_name(name);
    let row: Option<(bool,)> = sqlx::query_as("SELECT pg_try_advisory_lock($1)::bool")
        .bind(key)
        .fetch_one(db)
        .await
        .ok()
        .map(|(b,)| (b,));
    row.map(|(b,)| b).unwrap_or(false)
}

fn hash_name(name: &str) -> i64 {
    let mut h: i64 = 0;
    for b in name.as_bytes() {
        h = h.wrapping_mul(31).wrapping_add(*b as i64);
    }
    h
}

/// Spawn all periodic jobs. Each loops on an interval and is advisory-locked so only one
/// instance runs it. Non-fatal: errors are logged and the loop continues.
pub fn spawn(db: PgPool, polar_token: Option<String>, polar_org_id: Option<String>, http: reqwest::Client) {
    let d = db.clone();
    tokio::spawn(async move {
        // Polar order sync every 6h (with last-7d overlap to self-heal missed runs).
        if polar_token.is_some() && polar_org_id.is_some() {
            let polar = crate::services::polar::Polar {
                token: polar_token.clone(),
                org_id: polar_org_id.clone(),
                http: http.clone(),
            };
            let mut tick = tokio::time::interval(Duration::from_secs(6 * 60 * 60));
            loop {
                tick.tick().await;
                if !try_advisory_lock(&d, "polar_sync").await {
                    continue;
                }
                if let Err(e) = polar_sync(&d, &polar).await {
                    tracing::warn!(error = ?e, "polar sync job failed");
                }
            }
        }
    });

    let d2 = db.clone();
    tokio::spawn(async move {
        // Retention drop_chunks daily.
        let mut tick = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
        loop {
            tick.tick().await;
            if !try_advisory_lock(&d2, "retention").await {
                continue;
            }
            if let Err(e) = retention(&d2).await {
                tracing::warn!(error = ?e, "retention job failed");
            }
        }
    });

    let d3 = db.clone();
    tokio::spawn(async move {
        // ai_insights expiry cleanup hourly.
        let mut tick = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            tick.tick().await;
            if !try_advisory_lock(&d3, "ai_cleanup").await {
                continue;
            }
            if let Err(e) = ai_cleanup(&d3).await {
                tracing::warn!(error = ?e, "ai cleanup job failed");
            }
        }
    });

    let d4 = db.clone();
    tokio::spawn(async move {
        // visitor_profiles counter rollup hourly. The track hot path only does
        // first-sight INSERT (no per-event counter UPDATE -> no bloat); this job
        // recomputes total_sessions/pageviews/revenue + last_seen from events.
        let mut tick = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            tick.tick().await;
            if !try_advisory_lock(&d4, "visitor_rollup").await {
                continue;
            }
            if let Err(e) = visitor_rollup(&d4).await {
                tracing::warn!(error = ?e, "visitor rollup job failed");
            }
        }
    });
}

async fn polar_sync(db: &PgPool, polar: &crate::services::polar::Polar) -> Result<(), sqlx::Error> {
    use chrono::Utc;
    let since = (Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    let orders = polar.list_orders_since(&since).await.unwrap_or_default();
    let mut synced = 0;
    for order in &orders {
        if order.get("status").and_then(|v| v.as_str()) != Some("paid") {
            continue;
        }
        let email = order.get("customer").and_then(|c| c.get("email")).and_then(|v| v.as_str()).unwrap_or("");
        if email.is_empty() {
            continue;
        }
        let user_id: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
            .bind(email)
            .fetch_optional(db)
            .await?;
        let Some(uid) = user_id else { continue };
        let site_id: Option<String> = sqlx::query_scalar("SELECT id FROM sites WHERE user_id=$1 LIMIT 1")
            .bind(&uid)
            .fetch_optional(db)
            .await?;
        let Some(sid) = site_id else { continue };
        if crate::services::polar::process_polar_order(db, order, &sid).await.is_ok() {
            synced += 1;
        }
    }
    tracing::info!(synced, "polar cron sync complete");
    Ok(())
}

async fn retention(db: &PgPool) -> Result<(), sqlx::Error> {
    for tbl in ["events", "sessions", "heatmap_clicks", "heatmap_scrolls", "session_recordings"] {
        let _: Result<_, _> = sqlx::query(&format!(
            "SELECT drop_chunks('{tbl}', now() - interval '90 days')"
        ))
        .execute(db)
        .await;
    }
    tracing::info!("retention drop_chunks complete");
    Ok(())
}

async fn ai_cleanup(db: &PgPool) -> Result<(), sqlx::Error> {
    let res = sqlx::query("DELETE FROM ai_insights WHERE expires_at < now()")
        .execute(db)
        .await?;
    tracing::info!(deleted = res.rows_affected(), "expired ai_insights cleaned");
    Ok(())
}

/// Recompute visitor_profiles counters + last_seen from the last 30d of events.
/// Bounded to recent data to keep cost flat; full-history counters drift for
/// older visitors (acceptable — retention drops events at 90d anyway).
async fn visitor_rollup(db: &PgPool) -> Result<(), sqlx::Error> {
    let res = sqlx::query(
        "INSERT INTO visitor_profiles (id, site_id, visitor_id, first_seen, last_seen, total_sessions, total_pageviews, total_revenue) \
         SELECT gen_random_uuid()::text, site_id, visitor_id, MIN(timestamp), MAX(timestamp), \
                COUNT(DISTINCT session_id)::int, COUNT(*) FILTER (WHERE event_type='pageview')::int, \
                COALESCE(SUM(revenue) FILTER (WHERE revenue > 0), 0)::float8 \
         FROM events WHERE timestamp >= now() - interval '30 days' \
         GROUP BY site_id, visitor_id \
         ON CONFLICT (site_id, visitor_id) DO UPDATE SET \
           last_seen = EXCLUDED.last_seen, \
           total_sessions = EXCLUDED.total_sessions, \
           total_pageviews = EXCLUDED.total_pageviews, \
           total_revenue = EXCLUDED.total_revenue",
    )
    .execute(db)
    .await?;
    tracing::info!(rows = res.rows_affected(), "visitor_profiles rollup complete");
    Ok(())
}

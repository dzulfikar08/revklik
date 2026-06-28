use chrono::{DateTime, Datelike, Utc};
use dashmap::DashMap;
use std::sync::Arc;

use crate::error::{AppError, AppResult};
type Dt = DateTime<Utc>;

/// In-memory cache of per-site subscription/quota metadata, mirroring
/// lib/subscription-cache.ts: 60s TTL for active/trialing, 10s for inactive,
/// bounded to ~10k sites with LRU-ish eviction. The DB is the source of truth;
/// this only avoids recomputing the monthly event count on every /track hit.
#[derive(Clone, Debug)]
pub struct SiteMeta {
    pub plan: String,
    pub status: String,
    pub role: String,
    pub events_per_month: i64,
    pub sites_limit: i64,
    pub cached_count: i64,        // optimistic in-memory increment
    pub db_count: i64,            // last value fetched from DB
    pub fetched_at: DateTime<Utc>,
}

impl SiteMeta {
    pub fn total_count(&self) -> i64 {
        self.db_count + self.cached_count
    }
    pub fn ttl(&self) -> chrono::Duration {
        if self.status == "active" || self.status == "trialing" {
            chrono::Duration::seconds(60)
        } else {
            chrono::Duration::seconds(10)
        }
    }
    pub fn stale(&self, now: DateTime<Utc>) -> bool {
        now.signed_duration_since(self.fetched_at) > self.ttl()
    }
}

pub struct SiteMetaCache {
    map: DashMap<String, SiteMeta>,
    max_entries: usize,
}

impl SiteMetaCache {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { map: DashMap::with_capacity(2048), max_entries: 10_000 })
    }

    pub fn get(&self, site_id: &str) -> Option<SiteMeta> {
        self.map.get(site_id).map(|r| r.clone())
    }

    pub fn set(&self, site_id: &str, meta: SiteMeta) {
        if self.map.len() > self.max_entries {
            let drop_n = self.map.len() / 5;
            let keys: Vec<String> = self.map.iter().take(drop_n).map(|r| r.key().clone()).collect();
            for k in keys {
                self.map.remove(&k);
            }
        }
        self.map.insert(site_id.to_string(), meta);
    }

    /// Optimistic in-memory increment after an event is written.
    pub fn increment(&self, site_id: &str, by: i64) {
        if let Some(mut m) = self.map.get_mut(site_id) {
            m.cached_count += by;
        }
    }

    pub fn invalidate(&self, site_id: &str) {
        self.map.remove(site_id);
    }
}

fn month_start(now: DateTime<Utc>) -> DateTime<Utc> {
    let y = now.year();
    let m = now.month();
    let d = chrono::NaiveDate::from_ymd_opt(y, m, 1).unwrap_or_else(|| now.date_naive());
    d.and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Utc)
        .single()
        .unwrap_or(now)
}

/// Fetch fresh SiteMeta from DB (sites join users + subscriptions, count events this month).
pub async fn fetch_site_meta(db: &sqlx::PgPool, site_id: &str) -> AppResult<SiteMeta> {
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<Dt>)> = sqlx::query_as(
        "SELECT u.role, s.plan, s.status, s.current_period_end \
         FROM sites st \
         LEFT JOIN users u ON u.id = st.user_id \
         LEFT JOIN subscriptions s ON s.user_id = st.user_id \
         WHERE st.id = $1",
    )
    .bind(site_id)
    .fetch_optional(db)
    .await?;
    let Some((role, plan, status, end)) = row else {
        return Ok(SiteMeta {
            plan: "micro".into(), status: "active".into(), role: "user".into(),
            events_per_month: crate::services::plans::plan_def("micro").events_per_month,
            sites_limit: 1, cached_count: 0, db_count: 0, fetched_at: Utc::now(),
        });
    };

    let plan_raw = plan.unwrap_or_else(|| "micro".to_string());
    let status = status.unwrap_or_else(|| "active".to_string());
    let active = (status == "active" || status == "trialing")
        && end.map(|e| e >= Utc::now()).unwrap_or(true);
    let plan = if active { plan_raw } else { "micro".to_string() };
    let def = crate::services::plans::plan_def(&plan);

    let mstart = month_start(Utc::now());
    let cnt: (i64,) = sqlx::query_as("SELECT COUNT(id) FROM events WHERE site_id = $1 AND timestamp >= $2")
        .bind(site_id)
        .bind(mstart)
        .fetch_one(db)
        .await?;

    Ok(SiteMeta {
        plan,
        status,
        role: role.unwrap_or_else(|| "user".to_string()),
        events_per_month: def.events_per_month,
        sites_limit: def.sites,
        cached_count: 0,
        db_count: cnt.0,
        fetched_at: Utc::now(),
    })
}

/// Enforce the per-site monthly event quota. Returns the (possibly cached) SiteMeta.
/// `increment` = number of events about to be written this request.
pub async fn enforce_site_quota(
    db: &sqlx::PgPool,
    cache: &std::sync::Arc<SiteMetaCache>,
    site_id: &str,
    increment: i64,
) -> AppResult<SiteMeta> {
    let now = Utc::now();
    let meta = match cache.get(site_id) {
        Some(m) if !m.stale(now) => m,
        _ => {
            let m = fetch_site_meta(db, site_id).await?;
            cache.set(site_id, m.clone());
            m
        }
    };
    if meta.role != "super_admin" {
        let projected = meta.total_count() + increment;
        if projected > meta.events_per_month {
            return Err(AppError::QuotaExceeded(format!(
                "Event quota exceeded ({}/{} this month, {} plan)",
                meta.total_count(),
                meta.events_per_month,
                meta.plan
            )));
        }
    }
    Ok(meta)
}

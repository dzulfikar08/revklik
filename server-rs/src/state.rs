use crate::config::Config;
use crate::middleware::rate_limiter::RateLimiter;
use crate::services::geoip::Geoip;
use crate::services::quota::SiteMetaCache;
use sqlx::PgPool;
use std::sync::Arc;

/// Shared application state, cloned into every request handler.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub geoip: Arc<Geoip>,
    pub rate_limiter: Arc<RateLimiter>,
    pub site_meta: Arc<SiteMetaCache>,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(db: PgPool, config: Arc<Config>, geoip: Arc<Geoip>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("revklik-server/0.1")
            .build()
            .expect("reqwest client");
        Self {
            db,
            config,
            geoip,
            rate_limiter: RateLimiter::new(),
            site_meta: SiteMetaCache::new(),
            http,
        }
    }
}

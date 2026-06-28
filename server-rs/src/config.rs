use figment::{providers::Env, providers::Serialized, Figment};
use serde::Deserialize;

/// Server configuration. Loaded from environment (REV_ prefix is stripped).
/// See .env.example for every key.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct Config {
    pub database_url: String,
    pub host: String,
    pub port: u16,

    /// Comma-separated allowed CORS origins.
    pub cors_origins: String,

    /// GeoLite2-City.mmdb path (MaxMind). If absent, geo attribution is skipped.
    pub geoip_db_path: Option<String>,

    /// Trusted proxy hop count for X-Forwarded-For (0 = take leftmost raw).
    pub trusted_proxy_hops: usize,

    // ---- LLM (OpenAI-compatible) ----
    pub llm_base_url: String,
    pub llm_api_key: Option<String>,
    pub llm_model: String,

    // ---- Polar billing ----
    pub polar_access_token: Option<String>,
    pub polar_org_id: Option<String>,
    pub polar_webhook_secret: Option<String>,

    // ---- Google OAuth ----
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub google_redirect_uri: Option<String>,

    // ---- Marketplaces ----
    pub shopee_partner_id: Option<String>,
    pub shopee_partner_key: Option<String>,
    pub shopee_shop_id: Option<String>,
    pub tokopedia_client_id: Option<String>,
    pub tokopedia_client_secret: Option<String>,
    pub tokopedia_fs_id: Option<String>,

    // ---- Cloudflare Email (REST) ----
    pub cf_email_api_base: Option<String>,
    pub cf_email_api_token: Option<String>,
    pub cf_email_account_id: Option<String>,
    pub email_from: String,

    // ---- Pakasir ----
    pub pakasir_api_key: Option<String>,

    /// Run cron/jobs interval tasks (disable on migration-only runs).
    pub enable_jobs: bool,

    /// Directory of the built SPA to serve (client/dist). If absent, API-only.
    pub static_dir: Option<String>,

    /// Email that auto-grants super_admin role on register / Google login.
    pub super_admin_email: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let cfg: Config = Figment::from(Serialized::defaults(Config::default()))
            .merge(Env::prefixed("REV_"))
            .extract()?;
        Ok(cfg)
    }

    pub fn cors_origin_list(&self) -> Vec<String> {
        self.cors_origins
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            database_url: "postgres://revklik:revklik@localhost:5432/revklik".into(),
            host: "0.0.0.0".into(),
            port: 8787,
            cors_origins: "*".into(),
            geoip_db_path: None,
            trusted_proxy_hops: 1,
            llm_base_url: "https://api.openai.com/v1".into(),
            llm_api_key: None,
            llm_model: "gpt-4o-mini".into(),
            polar_access_token: None,
            polar_org_id: None,
            polar_webhook_secret: None,
            google_client_id: None,
            google_client_secret: None,
            google_redirect_uri: None,
            shopee_partner_id: None,
            shopee_partner_key: None,
            shopee_shop_id: None,
            tokopedia_client_id: None,
            tokopedia_client_secret: None,
            tokopedia_fs_id: None,
            cf_email_api_base: None,
            cf_email_api_token: None,
            cf_email_account_id: None,
            email_from: "RevKlik <noreply@revklik.com>".into(),
            pakasir_api_key: None,
            enable_jobs: true,
            super_admin_email: None,
            static_dir: None,
        }
    }
}

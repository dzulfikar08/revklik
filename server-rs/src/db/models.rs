use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ---- core rows ----

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub name: String,
    pub google_id: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ApiKey {
    pub id: String,
    pub user_id: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub name: String,
    pub token_type: String,
    pub scopes: Option<serde_json::Value>,
    pub site_id: Option<String>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl ApiKey {
    pub fn scopes_vec(&self) -> Vec<String> {
        self.scopes
            .as_ref()
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Site {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub domain: String,
    pub share_token: Option<String>,
    pub public_dashboard: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Subscription {
    pub id: String,
    pub user_id: String,
    pub plan: String,
    pub status: String,
    pub current_period_start: DateTime<Utc>,
    pub current_period_end: DateTime<Utc>,
    pub cancel_at_period_end: bool,
    pub polar_subscription_id: Option<String>,
    pub polar_customer_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---- public API auth context ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenType {
    Session,
    Account,
    Site,
}

impl TokenType {
    pub fn from_token(token: &str) -> Option<Self> {
        if token.starts_with("kp_") {
            Some(Self::Session)
        } else if token.starts_with("rvt_") {
            Some(Self::Account)
        } else if token.starts_with("rv_") {
            Some(Self::Site)
        } else {
            None
        }
    }
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Account => "account",
            Self::Site => "site",
        }
    }
}

/// Default scopes when a token has none stored (mirrors scope-validator defaults).
pub const DEFAULT_ACCOUNT_SCOPES: &[&str] = &[
    "sites:read",
    "analytics:read",
    "analytics:export",
    "tokens:read",
    "tokens:write",
];
pub const DEFAULT_SITE_SCOPES: &[&str] = &["analytics:read", "analytics:export"];

#[derive(Debug, Clone, Deserialize)]
pub struct NewSubscriptionTrial {
    pub plan: String,
}

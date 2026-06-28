use crate::db::models::{ApiKey, TokenType, DEFAULT_ACCOUNT_SCOPES, DEFAULT_SITE_SCOPES};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use async_trait::async_trait;
use axum::extract::FromRequestParts;
use chrono::Utc;

/// Parse a Bearer token from Authorization header.
pub fn bearer_token(headers: &axum::http::HeaderMap) -> AppResult<String> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let token = auth.strip_prefix("Bearer ").ok_or(AppError::Unauthorized)?;
    if token.is_empty() {
        return Err(AppError::Unauthorized);
    }
    Ok(token.to_string())
}

/// Load an api_keys row by hashing the raw token. None if not found.
pub async fn lookup_token(db: &sqlx::PgPool, token: &str) -> AppResult<Option<ApiKey>> {
    let hash = crate::services::fingerprint::hash_token(token);
    let row = sqlx::query_as::<_, ApiKey>(
        r#"SELECT id, user_id, key_hash, key_prefix, name, token_type, scopes,
                  site_id, last_used_at, expires_at, created_at
             FROM api_keys WHERE key_hash = $1"#,
    )
    .bind(hash)
    .fetch_optional(db)
    .await?;
    Ok(row)
}

/// Fire-and-forget last_used_at touch.
pub fn touch_last_used(db: sqlx::PgPool, key_id: String) {
    tokio::spawn(async move {
        let _ = sqlx::query("UPDATE api_keys SET last_used_at = $1 WHERE id = $2")
            .bind(Utc::now())
            .bind(key_id)
            .execute(&db)
            .await;
    });
}

/// Authenticated principal (any valid kp_/rvt_/rv_ token). Used by dashboard /api routes.
#[derive(Debug, Clone)]
pub struct Auth {
    pub user_id: String,
    pub token_type: TokenType,
    pub scopes: Vec<String>,
    pub site_id: Option<String>,
    pub token_id: String,
}

impl Auth {
    /// Build an Auth with only a user_id (for internal site-access checks, e.g. marketplaces).
    pub fn stub(user_id: &str) -> Self {
        Self {
            user_id: user_id.to_string(),
            token_type: TokenType::Session,
            scopes: vec![],
            site_id: None,
            token_id: String::new(),
        }
    }
    pub fn is_super_admin(&self) -> bool {
        self.scopes.iter().any(|s| s == "super_admin") // not used; role checked via DB
    }
    /// Resolve the user's role from DB (for admin gating).
    pub async fn user_role(&self, db: &sqlx::PgPool) -> AppResult<String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT role FROM users WHERE id = $1")
            .bind(&self.user_id)
            .fetch_optional(db)
            .await?;
        Ok(row.map(|(r,)| r).unwrap_or_else(|| "user".into()))
    }

    pub fn require_scope(&self, scope: &str) -> AppResult<()> {
        if self.scopes.iter().any(|s| s == scope) {
            Ok(())
        } else {
            Err(AppError::Forbidden(format!("Insufficient scope (required: {scope})")))
        }
    }
}

#[async_trait]
impl FromRequestParts<AppState> for Auth {
    type Rejection = AppError;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(&parts.headers)?;
        let kind = TokenType::from_token(&token).ok_or(AppError::Unauthorized)?;
        let api_key = lookup_token(&state.db, &token)
            .await?
            .ok_or(AppError::Unauthorized)?;

        // Validate token_type matches prefix.
        if api_key.token_type != kind.as_db_str() {
            return Err(AppError::Unauthorized);
        }
        // Expiry.
        if let Some(exp) = api_key.expires_at {
            if exp < Utc::now() {
                return Err(AppError::Forbidden("Token expired".into()));
            }
        }

        touch_last_used(state.db.clone(), api_key.id.clone());

        let mut scopes = api_key.scopes_vec();
        if scopes.is_empty() {
            scopes = match kind {
                TokenType::Account => DEFAULT_ACCOUNT_SCOPES.iter().map(|s| s.to_string()).collect(),
                TokenType::Site => DEFAULT_SITE_SCOPES.iter().map(|s| s.to_string()).collect(),
                TokenType::Session => vec![],
            };
        }

        Ok(Auth {
            user_id: api_key.user_id,
            token_type: kind,
            scopes,
            site_id: api_key.site_id,
            token_id: api_key.id,
        })
    }
}

/// Public API auth (rvt_/rv_ only). Used by /api/v1.
#[derive(Debug, Clone)]
pub struct PublicAuth(pub Auth);

#[async_trait]
impl FromRequestParts<AppState> for PublicAuth {
    type Rejection = AppError;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth = Auth::from_request_parts(parts, state).await?;
        match auth.token_type {
            TokenType::Account | TokenType::Site => Ok(PublicAuth(auth)),
            TokenType::Session => Err(AppError::Forbidden(
                "Invalid token type. Use an rvt_ account token or rv_ site token".into(),
            )),
        }
    }
}

/// Admin (super_admin) auth.
#[derive(Debug, Clone)]
pub struct AdminAuth(pub Auth);

#[async_trait]
impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = AppError;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth = Auth::from_request_parts(parts, state).await?;
        let role = auth.user_role(&state.db).await?;
        if role != "super_admin" {
            return Err(AppError::Forbidden("Admin access required".into()));
        }
        Ok(AdminAuth(auth))
    }
}

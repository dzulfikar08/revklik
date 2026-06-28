use crate::error::{AppError, AppResult};
use crate::services::fingerprint::{generate_api_key, hash_password_argon2, hash_token, hash_password_legacy};
use crate::state::AppState;
use crate::web::{created, new_id, ok, random_token};
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct RegisterReq {
    pub name: String,
    pub email: String,
    pub password: String,
}

/// Create a 7-day Starter trial subscription (mirrors auth.ts).
async fn create_trial(db: &sqlx::PgPool, user_id: &str) -> AppResult<()> {
    let now = Utc::now();
    let end = now + chrono::Duration::days(7);
    sqlx::query(
        r#"INSERT INTO subscriptions
             (id, user_id, plan, status, current_period_start, current_period_end,
              cancel_at_period_end, polar_subscription_id, polar_customer_id, created_at, updated_at)
           VALUES ($1,$2,'starter','trialing',$3,$4,false,NULL,NULL,$3,$3)"#,
    )
    .bind(new_id())
    .bind(user_id)
    .bind(now)
    .bind(end)
    .execute(db)
    .await?;
    Ok(())
}

/// Insert an api_keys session row; returns the plaintext key.
async fn issue_session(db: &sqlx::PgPool, user_id: &str, name: &str) -> AppResult<String> {
    let (key, prefix) = generate_api_key("session");
    sqlx::query(
        r#"INSERT INTO api_keys
             (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id, last_used_at, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,'session',NULL,NULL,NULL,NULL,$6)"#,
    )
    .bind(new_id())
    .bind(user_id)
    .bind(hash_token(&key))
    .bind(prefix)
    .bind(name)
    .bind(Utc::now())
    .execute(db)
    .await?;
    Ok(key)
}

pub async fn register(
    State(state): State<AppState>,
    Query(q): Query<RefQuery>,
    axum::Json(body): axum::Json<RegisterReq>,
) -> AppResult<Response> {
    let db = &state.db;
    if body.name.trim().is_empty() || body.email.trim().is_empty() || body.password.is_empty() {
        return Err(AppError::bad_request("All fields required"));
    }

    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
        .bind(&body.email)
        .fetch_optional(db)
        .await?;
    if exists.is_some() {
        return Err(AppError::Conflict("Email taken".into()));
    }

    let super_admin = state
        .config
        .super_admin_email
        .as_deref()
        .map(|e| e == body.email)
        .unwrap_or(false);
    let role = if super_admin { "super_admin" } else { "user" };
    let user_id = new_id();
    let phc = hash_password_argon2(&body.password)
        .map_err(|e| AppError::internal(format!("hash: {e}")))?;

    sqlx::query(
        r#"INSERT INTO users (id, email, password_hash, name, role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)"#,
    )
    .bind(&user_id)
    .bind(&body.email)
    .bind(&phc)
    .bind(&body.name)
    .bind(role)
    .bind(Utc::now())
    .execute(db)
    .await?;

    let token = issue_session(db, &user_id, "default").await?;
    create_trial(db, &user_id).await.ok(); // best-effort

    // Referral tracking.
    if let Some(ref_code) = q.ref_code.as_deref().filter(|s| !s.is_empty()) {
        let aff: Option<(String,)> = sqlx::query_as("SELECT id FROM affiliates WHERE referral_code = $1")
            .bind(ref_code)
            .fetch_optional(db)
            .await?;
        if let Some((aff_id,)) = aff {
            let _ = sqlx::query(
                "INSERT INTO referrals (id, affiliate_id, referred_user_id, event, commission_amount, status, created_at) \
                 VALUES ($1,$2,$3,'signup',0,'confirmed',$4)",
            )
            .bind(new_id())
            .bind(aff_id)
            .bind(&user_id)
            .bind(Utc::now())
            .execute(db)
            .await;
        }
    }

    let user = json!({ "id": user_id, "name": body.name, "email": body.email, "role": role });
    Ok(created(json!({ "user": user, "token": token })))
}

#[derive(Deserialize, Default)]
pub struct RefQuery {
    #[serde(rename = "ref")]
    pub ref_code: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

pub async fn login(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<LoginReq>,
) -> AppResult<Response> {
    let db = &state.db;
    let row: Option<(String, String, String, String, String)> =
        sqlx::query_as("SELECT id, name, email, password_hash, role FROM users WHERE email = $1")
            .bind(&body.email)
            .fetch_optional(db)
            .await?;
    let Some((user_id, name, email, password_hash, role)) = row else {
        return Err(AppError::Unauthorized);
    };

    // Verify (argon2 preferred, legacy SHA-256 fallback). Transparent rehash on legacy match.
    let matches = match crate::services::fingerprint::verify_password(&body.password, &password_hash) {
        Some(true) => true,
        _ => false,
    };
    if !matches {
        return Err(AppError::Unauthorized);
    }
    if !password_hash.starts_with("$argon2") {
        if let Ok(new_hash) = hash_password_argon2(&body.password) {
            let _ = sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
                .bind(new_hash)
                .bind(&user_id)
                .execute(db)
                .await;
            tracing::info!(user_id, "rehashed legacy password to argon2id");
        }
    }

    let token = issue_session(db, &user_id, "session").await?;
    let user = json!({ "id": user_id, "name": name, "email": email, "role": role });
    Ok(ok(json!({ "user": user, "token": token })))
}

pub async fn me(auth: crate::middleware::auth::Auth, State(state): State<AppState>) -> AppResult<Response> {
    let row: Option<(String, String, String, String)> =
        sqlx::query_as("SELECT id, name, email, role FROM users WHERE id = $1")
            .bind(&auth.user_id)
            .fetch_optional(&state.db)
            .await?;
    let Some((id, name, email, role)) = row else {
        return Err(AppError::NotFound);
    };
    Ok(ok(json!({ "user": { "id": id, "name": name, "email": email, "role": role } })))
}

// ---------- Google OAuth ----------

#[derive(Deserialize)]
pub struct GoogleStartQuery {
    // optional explicit redirect target after login
    pub redirect: Option<String>,
}

pub async fn google_start(
    State(state): State<AppState>,
    Query(q): Query<GoogleStartQuery>,
) -> AppResult<Response> {
    let client_id = state.config.google_client_id.as_deref().unwrap_or("");
    let redirect_uri = state
        .config
        .google_redirect_uri
        .clone()
        .unwrap_or_else(|| format!("https://{}/api/auth/google/callback", "api.example.com"));
    let state_param = new_id();
    let params = format!(
        "client_id={cid}&redirect_uri={ru}&response_type=code&scope={sc}&state={st}&access_type=offline&prompt=consent",
        cid = urlencoding(client_id),
        ru = urlencoding(&redirect_uri),
        sc = urlencoding("openid email profile"),
        st = state_param
    );
    let url = format!("https://accounts.google.com/o/oauth2/v2/auth?{params}");
    Ok(Redirect::temporary(&url).into_response())
}

#[derive(Deserialize)]
pub struct GoogleCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

pub async fn google_callback(
    State(state): State<AppState>,
    Query(q): Query<GoogleCallbackQuery>,
) -> AppResult<Response> {
    let db = &state.db;
    if q.error.is_some() || q.code.is_none() {
        return Err(AppError::bad_request("Missing code or state"));
    }
    let code = q.code.unwrap();
    let client_id = state.config.google_client_id.as_deref().unwrap_or("");
    let client_secret = state.config.google_client_secret.clone().unwrap_or_default();
    let redirect_uri = state
        .config
        .google_redirect_uri
        .clone()
        .unwrap_or_else(|| format!("https://{}/api/auth/google/callback", "api.example.com"));

    // Exchange code -> tokens.
    let form = [
        ("code", code.as_str()),
        ("client_id", client_id),
        ("client_secret", client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];
    let token_res: Value = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|e| AppError::internal(format!("OAuth token exchange failed: {e}")))?
        .json::<Value>()
        .await
        .map_err(|e| AppError::internal(format!("OAuth token parse failed: {e}")))?;

    if token_res.get("error").is_some() {
        return Err(AppError::bad_request(
            token_res
                .get("error_description")
                .and_then(|v| v.as_str())
                .unwrap_or("oauth error"),
        ));
    }
    let access_token = token_res
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::bad_request("No access token"))?;

    let profile: Value = state
        .http
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::internal(format!("profile fetch failed: {e}")))?
        .json::<Value>()
        .await
        .map_err(|e| AppError::internal(format!("profile parse failed: {e}")))?;

    let email = profile
        .get("email")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::bad_request("No email from Google"))?;
    let sub = profile.get("sub").and_then(|v| v.as_str());
    let name = profile
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| email.split('@').next().unwrap_or(email));
    let picture = profile.get("picture").and_then(|v| v.as_str());

    let is_super = state
        .config
        .super_admin_email
        .as_deref()
        .map(|e| e == email)
        .unwrap_or(false);

    // Find by google_id or email.
    let existing: Option<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, google_id, role FROM users WHERE google_id = $1 OR email = $2",
    )
    .bind(sub)
    .bind(email)
    .fetch_optional(db)
    .await?;

    let user_id = if let Some((uid, google_id, role)) = existing {
        if google_id.is_none() && sub.is_some() {
            let _ = sqlx::query("UPDATE users SET google_id = $1, avatar_url = COALESCE($2, avatar_url) WHERE id = $3")
                .bind(sub)
                .bind(picture)
                .bind(&uid)
                .execute(db)
                .await;
        }
        if is_super && role != "super_admin" {
            let _ = sqlx::query("UPDATE users SET role = 'super_admin' WHERE id = $1")
                .bind(&uid)
                .execute(db)
                .await;
        }
        uid
    } else {
        let uid = new_id();
        let role = if is_super { "super_admin" } else { "user" };
        sqlx::query(
            "INSERT INTO users (id, email, password_hash, name, google_id, avatar_url, role, created_at) \
             VALUES ($1,$2,'',$3,$4,$5,$6,$7)",
        )
        .bind(&uid)
        .bind(email)
        .bind(name)
        .bind(sub)
        .bind(picture)
        .bind(role)
        .bind(Utc::now())
        .execute(db)
        .await?;
        create_trial(db, &uid).await.ok();
        uid
    };

    let token = issue_session(db, &user_id, "session").await?;
    let app_url = format!("https://{}/#token={token}", "app.example.com");
    Ok(Redirect::temporary(&app_url).into_response())
}

fn urlencoding(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

// keep legacy helper referenced
#[allow(dead_code)]
fn _unused_legacy(p: &str) -> String {
    hash_password_legacy(p)
}

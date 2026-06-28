use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::services::fingerprint::{generate_api_key, hash_token};
use crate::services::plans::{effective_plan, token_limit};
use crate::state::AppState;
use crate::web::{created, new_id, ok};
use axum::extract::{Path, State};
use axum::response::Response;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

const VALID_SCOPES: &[&str] = &[
    "sites:read",
    "analytics:read",
    "analytics:export",
    "tokens:read",
    "tokens:write",
];
const DEFAULT_ACCOUNT_SCOPES: &[&str] = &["sites:read", "analytics:read", "analytics:export", "tokens:read", "tokens:write"];
const DEFAULT_SITE_SCOPES: &[&str] = &["analytics:read", "analytics:export"];

pub async fn list(auth: Auth, State(state): State<AppState>) -> AppResult<Response> {
    let db = &state.db;
    let rows: Vec<(String, String, String, Option<Value>, Option<String>, Option<chrono::DateTime<Utc>>, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, key_prefix, name, scopes, site_id, last_used_at, created_at FROM api_keys \
         WHERE user_id = $1 AND token_type IN ('account','site') ORDER BY created_at DESC",
    )
    .bind(&auth.user_id)
    .fetch_all(db)
    .await?;

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, prefix, name, scopes, site_id, last_used_at, created_at)| {
            let scopes_arr: Vec<String> = scopes
                .as_ref()
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                .unwrap_or_default();
            json!({
                "id": id,
                "prefix": prefix,
                "name": name,
                "type": "account", // resolved below
                "scopes": scopes_arr,
                "site_id": site_id,
                "last_used_at": last_used_at,
                "created_at": created_at,
            })
        })
        .collect();
    Ok(ok(json!({ "data": data })))
}

#[derive(Deserialize)]
pub struct CreateReq {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub scopes: Option<Vec<String>>,
    pub site_id: Option<String>,
}

pub async fn create(
    auth: Auth,
    State(state): State<AppState>,
    axum::Json(body): axum::Json<CreateReq>,
) -> AppResult<Response> {
    let db = &state.db;
    if body.name.trim().is_empty() {
        return Err(AppError::bad_request("name and type are required"));
    }
    if body.kind != "account" && body.kind != "site" {
        return Err(AppError::bad_request("type must be 'account' or 'site'"));
    }
    let is_site = body.kind == "site";
    let site_id = body.site_id.as_deref();
    if is_site && site_id.map(|s| s.is_empty()).unwrap_or(true) {
        return Err(AppError::bad_request("site_id is required for site tokens"));
    }

    // Validate site ownership for site tokens.
    if is_site {
        if let Some(sid) = site_id {
            let access: Option<(i64,)> = sqlx::query_as(
                "SELECT 1::bigint FROM sites s WHERE s.id = $1 AND (s.user_id = $2 OR EXISTS \
                 (SELECT 1 FROM team_members t WHERE t.site_id = s.id AND t.user_id = $2 AND t.accepted_at IS NOT NULL))",
            )
            .bind(sid)
            .bind(&auth.user_id)
            .fetch_optional(db)
            .await?;
            if access.is_none() {
                return Err(AppError::NotFound);
            }
        }
    }

    // Plan token limit.
    let (plan, _) = effective_plan(db, &auth.user_id).await;
    let max = token_limit(&plan);
    let existing: (i64,) = sqlx::query_as(
        "SELECT COUNT(id) FROM api_keys WHERE user_id = $1 AND token_type IN ('account','site')",
    )
    .bind(&auth.user_id)
    .fetch_one(db)
    .await?;
    if existing.0 >= max {
        return Err(AppError::Forbidden(format!(
            "Token limit reached. Your plan ({plan}) allows up to {} API tokens.",
            if max == i64::MAX { "unlimited".into() } else { max.to_string() }
        )));
    }

    // Resolve scopes.
    let mut scopes: Vec<String> = body
        .scopes
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| {
            (if is_site { DEFAULT_SITE_SCOPES } else { DEFAULT_ACCOUNT_SCOPES })
                .iter()
                .map(|s| s.to_string())
                .collect()
        });
    let invalid: Vec<&String> = scopes.iter().filter(|s| !VALID_SCOPES.contains(&s.as_str())).collect();
    if !invalid.is_empty() {
        let names: Vec<String> = invalid.into_iter().map(|s| s.clone()).collect();
        return Err(AppError::bad_request(format!("Invalid scopes: {}", names.join(", "))));
    }
    if is_site {
        let allowed = ["analytics:read", "analytics:export"];
        let disallowed: Vec<&String> = scopes.iter().filter(|s| !allowed.contains(&s.as_str())).collect();
        if !disallowed.is_empty() {
            return Err(AppError::bad_request(
                "Site tokens can only have scopes: analytics:read, analytics:export",
            ));
        }
    }

    let (key, prefix) = generate_api_key(&body.kind);
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id, last_used_at, expires_at, created_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9)",
    )
    .bind(new_id())
    .bind(&auth.user_id)
    .bind(hash_token(&key))
    .bind(&prefix)
    .bind(&body.name)
    .bind(&body.kind)
    .bind(serde_json::to_value(&scopes).unwrap())
    .bind(if is_site { site_id } else { None })
    .bind(now)
    .execute(db)
    .await?;

    Ok(created(json!({
        "token": key,
        "prefix": prefix,
        "scopes": scopes,
        "site_id": if is_site { site_id } else { None },
        "created_at": now,
    })))
}

pub async fn revoke(
    auth: Auth,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let db = &state.db;
    let row: Option<(String, String)> = sqlx::query_as("SELECT user_id, token_type FROM api_keys WHERE id = $1")
        .bind(&id)
        .fetch_optional(db)
        .await?;
    let Some((owner_id, ttype)) = row else {
        return Err(AppError::NotFound);
    };
    if owner_id != auth.user_id {
        return Err(AppError::Forbidden("You can only revoke your own tokens".into()));
    }
    if ttype == "session" {
        return Err(AppError::bad_request("Cannot revoke session tokens via this endpoint"));
    }
    sqlx::query("DELETE FROM api_keys WHERE id = $1").bind(&id).execute(db).await?;
    Ok(ok(json!({ "id": id, "revoked": true })))
}

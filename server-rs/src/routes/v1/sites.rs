use crate::error::{AppError, AppResult};
use crate::middleware::auth::PublicAuth;
use crate::middleware::site_access;
use crate::state::AppState;
use crate::web::ok;
use axum::extract::{Path, State};
use axum::response::Response;
use serde_json::{json, Value};

/// List sites accessible to the token (owned + accepted team sites; site tokens → bound site only).
pub async fn list(auth: PublicAuth, State(state): State<AppState>) -> AppResult<Response> {
    let db = &state.db;
    // Site token: only its bound site.
    if let Some(site_id) = &auth.0.site_id {
        let row: Option<(String, String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
            "SELECT id, name, domain, created_at FROM sites WHERE id = $1",
        )
        .bind(site_id)
        .fetch_optional(db)
        .await?;
        let data: Vec<Value> = row
            .into_iter()
            .map(|(id, name, domain, created_at)| json!({ "id": id, "name": name, "domain": domain, "created_at": created_at }))
            .collect();
        return Ok(ok(json!({ "data": data })));
    }

    let rows: Vec<(String, String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT DISTINCT s.id, s.name, s.domain, s.created_at FROM sites s \
         LEFT JOIN team_members t ON t.site_id = s.id \
         WHERE s.user_id = $1 OR (t.user_id = $1 AND t.accepted_at IS NOT NULL) \
         ORDER BY s.created_at DESC",
    )
    .bind(&auth.0.user_id)
    .fetch_all(db)
    .await?;
    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, domain, created_at)| json!({ "id": id, "name": name, "domain": domain, "created_at": created_at }))
        .collect();
    Ok(ok(json!({ "data": data })))
}

pub async fn get_one(
    auth: PublicAuth,
    State(state): State<AppState>,
    Path(site_id): Path<String>,
) -> AppResult<Response> {
    site_access::require(&state.db, &auth.0, &site_id).await?;
    let row: Option<(String, String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, name, domain, created_at FROM sites WHERE id = $1",
    )
    .bind(&site_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((id, name, domain, created_at)) = row else {
        return Err(AppError::NotFound);
    };
    Ok(ok(json!({ "id": id, "name": name, "domain": domain, "created_at": created_at })))
}

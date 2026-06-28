use crate::error::{AppError, AppResult};
use crate::middleware::auth::PublicAuth;
use crate::services::plans::effective_plan;
use crate::state::AppState;
use crate::web::ok;
use axum::extract::State;
use axum::response::Response;
use serde_json::json;

pub async fn whoami(auth: PublicAuth, State(state): State<AppState>) -> AppResult<Response> {
    let db = &state.db;
    let row: Option<(String, String, String)> = sqlx::query_as("SELECT id, name, email FROM users WHERE id = $1")
        .bind(&auth.0.user_id)
        .fetch_optional(db)
        .await?;
    let Some((id, name, email)) = row else {
        return Err(AppError::NotFound);
    };
    let (plan, _) = effective_plan(db, &auth.0.user_id).await;

    // token metadata
    let tok: Option<(String, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT name, created_at FROM api_keys WHERE id = $1")
            .bind(&auth.0.token_id)
            .fetch_optional(db)
            .await?;
    let (tok_name, tok_created) = tok.unwrap_or(("".into(), chrono::Utc::now()));

    Ok(ok(json!({
        "user": { "id": id, "name": name, "email": email },
        "plan": plan,
        "token": {
            "type": match auth.0.token_type {
                crate::db::models::TokenType::Account => "account",
                crate::db::models::TokenType::Site => "site",
                crate::db::models::TokenType::Session => "session",
            },
            "scopes": auth.0.scopes,
            "site_id": auth.0.site_id,
            "name": tok_name,
            "created_at": tok_created,
        }
    })))
}

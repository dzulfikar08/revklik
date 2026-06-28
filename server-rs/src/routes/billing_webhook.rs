use crate::error::{AppError, AppResult};
use crate::services::webhook_crypto::verify_standard_webhook;
use crate::state::AppState;
use crate::web::new_id;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use serde_json::Value;

/// POST /api/billing/webhook — Polar Standard Webhooks.
/// Verifies signature, then upserts the local subscription from subscription.created/updated.
pub async fn polar_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let secret = state.config.polar_webhook_secret.as_deref().ok_or_else(|| AppError::bad_request("no webhook secret configured"))?;
    let msg_id = headers.get("webhook-id").and_then(|h| h.to_str().ok()).unwrap_or("");
    let ts = headers.get("webhook-timestamp").and_then(|h| h.to_str().ok()).unwrap_or("");
    let sig = headers.get("webhook-signature").and_then(|h| h.to_str().ok()).unwrap_or("");
    if !verify_standard_webhook(msg_id, ts, sig, &body, secret) {
        return Ok((StatusCode::UNAUTHORIZED, "invalid signature").into_response());
    }

    let payload: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad_request("invalid json"))?;
    let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let data = payload.get("data").unwrap_or(&Value::Null);

    // Always log the webhook.
    let _ = sqlx::query("INSERT INTO webhook_logs (id, site_id, provider, event_type, payload, status, created_at) VALUES ($1,'','polar',$2,$3,'processed',now())")
        .bind(new_id())
        .bind(event_type)
        .bind(serde_json::to_value(&payload).unwrap_or(Value::Null))
        .execute(&state.db)
        .await;

    if let Some(sub) = data.get("object").or(Some(data)) {
        if matches!(event_type, "subscription.created" | "subscription.updated" | "subscription.active") {
            if let (Some(customer_id), Some(user_email)) = (sub.get("customer_id").and_then(|v| v.as_str()), sub.get("user_email").or_else(|| sub.get("email")).and_then(|v| v.as_str())) {
                let _ = upsert_subscription_by_email(&state.db, user_email, customer_id, sub).await;
            }
        }
    }

    Ok((StatusCode::OK, "{\"success\":true}").into_response())
}

async fn upsert_subscription_by_email(db: &sqlx::PgPool, email: &str, customer_id: &str, sub: &Value) -> AppResult<()> {
    let user_id: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
        .bind(email)
        .fetch_optional(db)
        .await?;
    let Some(user_id) = user_id else { return Ok(()); };

    let plan = map_product_to_plan(sub);
    let status = sub.get("status").and_then(|v| v.as_str()).unwrap_or("active");
    let sub_id = sub.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let current_end = sub.get("current_period_end").and_then(|v| v.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc)));
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO subscriptions (id, user_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, polar_subscription_id, polar_customer_id, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$5,$5) \
         ON CONFLICT (user_id) DO UPDATE SET plan=$3, status=$4, current_period_end=COALESCE($6, subscriptions.current_period_end), polar_subscription_id=$7, polar_customer_id=$8, updated_at=$5",
    )
    .bind(new_id())
    .bind(&user_id)
    .bind(&plan)
    .bind(status)
    .bind(now)
    .bind(current_end)
    .bind(sub_id)
    .bind(customer_id)
    .execute(db)
    .await?;
    Ok(())
}

fn map_product_to_plan(sub: &Value) -> String {
    // Product id -> plan mapping is configurable; default to plan from metadata or 'growth'.
    if let Some(p) = sub.pointer("/metadata/plan").and_then(|v| v.as_str()) {
        return p.to_string();
    }
    "growth".to_string()
}

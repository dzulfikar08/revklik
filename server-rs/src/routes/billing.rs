use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::services::plans::{plan_def, plan_features, plan_price, PLANS_ORDERED};
use crate::services::polar::Polar;
use crate::state::AppState;
use crate::web::{new_id, ok};
use axum::extract::State;
use axum::response::Response;
use chrono::{Datelike, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

fn month_start() -> chrono::DateTime<Utc> {
    let now = Utc::now();
    let d = chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1).unwrap_or(now.date_naive());
    d.and_hms_opt(0, 0, 0).unwrap().and_local_timezone(Utc).single().unwrap_or(now)
}

/// GET /billing/subscription — current subscription + usage + trial days remaining.
pub async fn subscription(auth: Auth, State(state): State<AppState>) -> AppResult<Response> {
    let db = &state.db;
    let row: Option<(String, String, chrono::DateTime<Utc>, chrono::DateTime<Utc>, bool, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT plan, status, current_period_start, current_period_end, cancel_at_period_end, polar_subscription_id, polar_customer_id \
         FROM subscriptions WHERE user_id=$1")
        .bind(&auth.user_id).fetch_optional(db).await?;

    let def = plan_def(row.as_ref().map(|r| r.0.as_str()).unwrap_or("micro"));
    let mstart = month_start();
    let event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE site_id IN (SELECT id FROM sites WHERE user_id=$1) AND timestamp >= $2")
        .bind(&auth.user_id).bind(mstart).fetch_one(db).await.unwrap_or(0);
    let site_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sites WHERE user_id=$1")
        .bind(&auth.user_id).fetch_one(db).await.unwrap_or(0);

    let usage = json!({
        "events": { "used": event_count, "limit": def.events_per_month },
        "sites": { "used": site_count, "limit": def.sites },
    });

    let resp = match row {
        Some((plan, status, cps, cpe, cancel, polar_sub, polar_cust)) => {
            let trial_days = if status == "trialing" {
                let diff = cpe.signed_duration_since(Utc::now());
                if diff.num_milliseconds() > 0 { Some(diff.num_days() + 1) } else { Some(0) }
            } else { None };
            json!({
                "id": "", "user_id": auth.user_id, "plan": plan, "status": status,
                "current_period_start": cps, "current_period_end": cpe,
                "cancel_at_period_end": cancel, "polar_subscription_id": polar_sub, "polar_customer_id": polar_cust,
                "usage": usage, "trial_days_remaining": trial_days,
            })
        }
        None => json!({
            "id": "", "user_id": auth.user_id, "plan": "micro", "status": "active",
            "current_period_start": Utc::now(), "current_period_end": Utc::now() + chrono::Duration::days(30),
            "cancel_at_period_end": false, "polar_subscription_id": null, "polar_customer_id": null,
            "usage": usage, "trial_days_remaining": null,
        }),
    };
    Ok(ok(resp))
}

/// GET /billing/plans — available plans (+ optional Polar checkout_url).
pub async fn plans(_auth: Auth, State(state): State<AppState>) -> AppResult<Response> {
    let mut plans: Vec<Value> = PLANS_ORDERED.iter().map(|tier| json!({
        "tier": tier, "name": plan_def(tier).name, "price": plan_price(tier),
        "events_per_month": plan_def(tier).events_per_month, "sites": plan_def(tier).sites,
        "features": plan_features(tier), "checkout_url": null,
    })).collect();

    let polar = Polar::from_state(&state);
    if polar.token.is_some() {
        if let Ok(products) = polar.list_products().await {
            if let Some(items) = products.get("items").and_then(|v| v.as_array()) {
                for p in plans.iter_mut() {
                    let tier = p.get("tier").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(prod) = items.iter().find(|pr| pr.get("name").and_then(|n| n.as_str()).map(|n| n.to_lowercase().contains(tier)).unwrap_or(false)) {
                        if let Some(url) = prod.get("checkout_url").and_then(|v| v.as_str()) {
                            p["checkout_url"] = json!(url);
                        }
                    }
                }
            }
        }
    }
    Ok(ok(json!(plans)))
}

#[derive(Deserialize)]
pub struct CheckoutReq {
    pub plan: String,
    #[allow(dead_code)]
    pub visitor_id: Option<String>,
    #[allow(dead_code)]
    pub session_id: Option<String>,
}

/// POST /billing/checkout {plan} → {url}.
pub async fn checkout(auth: Auth, State(state): State<AppState>, axum::Json(body): axum::Json<CheckoutReq>) -> AppResult<Response> {
    if PLANS_ORDERED.iter().all(|t| *t != body.plan.as_str()) {
        return Err(AppError::bad_request("Invalid plan"));
    }
    let polar = Polar::from_state(&state);
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id=$1").bind(&auth.user_id).fetch_optional(&state.db).await.ok().flatten();
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM users WHERE id=$1").bind(&auth.user_id).fetch_optional(&state.db).await.ok().flatten();

    if polar.token.is_none() {
        // No Polar configured — return direct link placeholder (matches TS fallback).
        return Ok(ok(json!({ "url": format!("https://polar.sh/revklik/checkout?plan={}", body.plan) })));
    }
    let success_url = std::env::var("REV_CHECKOUT_SUCCESS_URL").unwrap_or_else(|_| "https://app.revklik.com/?checkout=success".into());
    let res = polar.create_checkout_product(&body.plan, &success_url, email.as_deref(), name.as_deref(), &auth.user_id).await?;
    let url = res.get("url").and_then(|v| v.as_str()).unwrap_or(&success_url).to_string();
    Ok(ok(json!({ "url": url })))
}

const PAKASIR_SLUG: &str = "revklik";

/// POST /billing/checkout/pakasir {plan} → {url, order_id, amount, plan}.
pub async fn pakasir_checkout(auth: Auth, State(state): State<AppState>, axum::Json(body): axum::Json<CheckoutReq>) -> AppResult<Response> {
    if PLANS_ORDERED.iter().all(|t| *t != body.plan.as_str()) {
        return Err(AppError::bad_request("Invalid plan"));
    }
    if state.config.pakasir_api_key.is_none() {
        return Err(AppError::internal("Pakasir not configured"));
    }
    let amount: i64 = match body.plan.as_str() {
        "micro" => 16000,
        "starter" => 64000,
        "growth" => 192000,
        _ => return Err(AppError::bad_request("No IDR price for this plan")),
    };
    let order_id = format!("RVK-{}-{}", &auth.user_id[..8.min(auth.user_id.len())], chrono::Utc::now().timestamp().to_string());
    let success_url = format!("https://app.revklik.com/?checkout=pakasir_success&plan={}", body.plan);
    let url = format!("https://app.pakasir.com/pay/{PAKASIR_SLUG}/{amount}?order_id={order_id}&redirect={}&qris_only=1", urlenc(&success_url));

    // upsert pending subscription
    let now = Utc::now();
    let end = now + chrono::Duration::days(30);
    sqlx::query(
        "INSERT INTO subscriptions (id, user_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at) \
         VALUES ($1,$2,$3,'pending',$4,$5,false,$4,$4) \
         ON CONFLICT (user_id) DO UPDATE SET plan=$3, status='pending', current_period_end=$5, updated_at=$4")
        .bind(new_id()).bind(&auth.user_id).bind(&body.plan).bind(now).bind(end).execute(&state.db).await?;

    Ok(ok(json!({ "url": url, "order_id": order_id, "amount": amount, "plan": body.plan })))
}

/// POST /billing/cancel — cancel current user's Polar subscription.
pub async fn cancel(auth: Auth, State(state): State<AppState>) -> AppResult<Response> {
    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT polar_subscription_id FROM subscriptions WHERE user_id=$1")
        .bind(&auth.user_id).fetch_optional(&state.db).await?;
    let polar = Polar::from_state(&state);
    if polar.token.is_some() {
        if let Some((Some(sub_id),)) = &row {
            if !sub_id.is_empty() {
                let _ = polar.cancel_subscription(sub_id).await;
            }
        }
    }
    sqlx::query("UPDATE subscriptions SET cancel_at_period_end=true, updated_at=now() WHERE user_id=$1")
        .bind(&auth.user_id).execute(&state.db).await?;
    Ok(ok(json!({ "success": true })))
}

fn urlenc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

#[allow(dead_code)]
fn _v() -> Value { Value::Null }

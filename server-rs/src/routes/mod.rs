use crate::error::AppResult;
use crate::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Json;
use serde_json::json;

pub mod ai_insights;
pub mod analytics;
pub mod analytics_extra;
pub mod auth;
pub mod billing;
pub mod billing_webhook;
pub mod extra;
pub mod gsc;
pub mod marketplaces;
pub mod misc;
pub mod sites;
pub mod tokens;
pub mod track;
pub mod v1;
pub mod webhooks;

pub fn router(state: AppState) -> axum::Router {
    axum::Router::new()
        .route("/healthz", get(healthz))
        .route("/api/ping", get(ping))
        .route("/api/", get(root))
        .route("/api/health", get(health))
        // auth (public)
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/google", get(auth::google_start))
        .route("/api/auth/google/callback", get(auth::google_callback))
        .route("/api/auth/me", get(auth::me))
        // track ingest (public)
        .route("/api/track", post(track::track))
        .route("/api/identify", post(track::identify))
        .route("/api/track/heatmap", post(track::heatmap))
        .route("/api/track/recording", post(track::recording))
        .route("/api/track/payment", post(track::payment))
        // sites (Auth)
        .route("/api/sites", get(sites::list).post(sites::create))
        .route("/api/sites/:site_id", delete(sites::delete))
        .route("/api/sites/:site_id/snippet", get(sites::snippet))
        // tokens (Auth)
        .route("/api/tokens", get(tokens::list).post(tokens::create))
        .route("/api/tokens/:id", delete(tokens::revoke))
        // analytics (Auth)
        .route("/api/analytics/dashboard", get(analytics::dashboard))
        .route("/api/analytics/overview", get(analytics::overview_ep))
        .route("/api/analytics/timeseries", get(analytics::timeseries_ep))
        .route("/api/analytics/pages", get(analytics::pages_ep))
        .route("/api/analytics/referrers", get(analytics::referrers_ep))
        .route("/api/analytics/geo", get(analytics::geo_ep))
        .route("/api/analytics/devices", get(analytics::devices_ep))
        .route("/api/analytics/revenue", get(analytics::revenue_ep))
        .route("/api/analytics/sparkline", get(analytics::sparkline_ep))
        .route("/api/analytics/export", get(analytics::export_ep))
        .route("/api/analytics/stream", get(analytics::stream_ep))
        // analytics extra: funnel / visitors / heatmap / recordings
        .route("/api/analytics/funnel", get(analytics_extra::funnel))
        .route("/api/analytics/visitors", get(analytics_extra::visitors))
        .route("/api/analytics/visitors/:visitor_id", axum::routing::patch(analytics_extra::update_visitor))
        .route("/api/analytics/heatmap", get(analytics_extra::heatmap))
        .route("/api/analytics/recordings", get(analytics_extra::recordings))
        .route("/api/analytics/recordings/:id", get(analytics_extra::recording_detail))
        .route("/api/analytics/export-visitors", get(analytics_extra::export_visitors))
        .route("/api/analytics/export-sessions", get(analytics_extra::export_sessions))
        // public dashboard (no auth) + tracker script redirect
        .route("/api/public/:token", get(public_dashboard))
        .route("/api/klikapa.js", get(klikapa_js))
        // billing webhooks (public — providers call these)
        .route("/api/billing/webhook", post(billing_webhook::polar_webhook))
        .route("/api/webhooks/stripe", post(webhooks::stripe))
        .route("/api/webhooks/midtrans", post(webhooks::midtrans))
        .route("/api/webhooks/xendit", post(webhooks::xendit))
        .route("/api/webhooks/lemonsqueezy", post(webhooks::lemonsqueezy))
        .route("/api/webhooks/pakasir", post(webhooks::pakasir))
        // billing (Auth)
        .route("/api/billing/subscription", get(billing::subscription))
        .route("/api/billing/plans", get(billing::plans))
        .route("/api/billing/checkout", post(billing::checkout))
        .route("/api/billing/checkout/pakasir", post(billing::pakasir_checkout))
        .route("/api/billing/cancel", post(billing::cancel))
        // ai insights (Auth)
        .route("/api/ai-insights", get(ai_insights::insights))
        // misc CRUD (Auth)
        .route("/api/segments", get(misc::list_segments).post(misc::create_segment))
        .route("/api/segments/:id", delete(misc::delete_segment))
        .route("/api/annotations", get(misc::list_annotations).post(misc::create_annotation))
        .route("/api/annotations/:id", delete(misc::delete_annotation))
        .route("/api/push-tokens", post(misc::register_push).delete(misc::unregister_push))
        .route("/api/share/:site_id/toggle", post(misc::share_toggle))
        .route("/api/share/:site_id/status", get(misc::share_status))
        .route("/api/affiliates/me", get(misc::affiliate_me))
        .route("/api/affiliates/generate-code", post(misc::affiliate_generate))
        .route("/api/widget-data", get(misc::widget_data))
        // team (Auth)
        .route("/api/team", get(extra::team_list).post(extra::team_invite))
        .route("/api/team/:id", axum::routing::patch(extra::team_update).delete(extra::team_remove))
        // email reports (Auth)
        .route("/api/email-reports", get(extra::report_list).post(extra::report_create))
        .route("/api/email-reports/:id", axum::routing::put(extra::report_update).delete(extra::report_delete))
        // integrations (Auth)
        .route("/api/integrations", get(extra::int_list).post(extra::int_create))
        .route("/api/integrations/:id", axum::routing::patch(extra::int_update).delete(extra::int_delete))
        // payment providers (Auth)
        .route("/api/payment-providers", get(extra::pp_list).post(extra::pp_create))
        .route("/api/payment-providers/:id", delete(extra::pp_delete))
        // admin (super_admin)
        .route("/api/admin/stats", get(extra::admin_stats))
        .route("/api/admin/users", get(extra::admin_users))
        // import (Auth)
        .route("/api/import/polar-orders", post(extra::import_polar))
        .route("/api/import/onedollarstats", post(extra::import_onedollarstats))
        // docs
        .route("/api/docs", get(extra::docs))
        // marketplaces (auth+callback are public, sync/orders Auth)
        .route("/api/marketplace/shopee/auth", get(marketplaces::shopee_auth))
        .route("/api/marketplace/shopee/callback", get(marketplaces::shopee_callback))
        .route("/api/marketplace/shopee/sync", post(marketplaces::shopee_sync))
        .route("/api/marketplace/shopee/orders", get(marketplaces::shopee_orders))
        .route("/api/marketplace/tokopedia/auth", get(marketplaces::tokopedia_auth))
        .route("/api/marketplace/tokopedia/callback", get(marketplaces::tokopedia_callback))
        .route("/api/marketplace/tokopedia/sync", post(marketplaces::tokopedia_sync))
        .route("/api/marketplace/tokopedia/orders", get(marketplaces::tokopedia_orders))
        // gsc (auth+callback public, queries/sync Auth)
        .route("/api/gsc/auth", get(gsc::auth))
        .route("/api/gsc/callback", get(gsc::callback))
        .route("/api/gsc/queries", get(gsc::queries))
        .route("/api/gsc/sync", post(gsc::sync))
        // public API v1
        .nest("/api/v1", v1::router())
        .with_state(state)
}

async fn healthz(State(state): State<AppState>) -> AppResult<impl IntoResponse> {
    sqlx::query("SELECT 1")
        .fetch_one(&state.db)
        .await
        .map_err(|e| crate::error::AppError::internal(format!("db unhealthy: {e}")))?;
    Ok(Json(json!({ "status": "ok" })))
}

async fn ping() -> AppResult<impl IntoResponse> {
    Ok(Json(json!({ "pong": true })))
}

async fn root() -> AppResult<impl IntoResponse> {
    Ok(Json(json!({ "message": "klikapa", "version": "0.7.0", "success": true })))
}

async fn health() -> AppResult<impl IntoResponse> {
    Ok(Json(json!({ "status": "ok", "success": true })))
}

/// GET /api/public/:token — public dashboard (site with public_dashboard + matching share_token).
async fn public_dashboard(
    State(state): State<AppState>,
    axum::extract::Path(token): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<PublicDashQuery>,
) -> AppResult<impl IntoResponse> {
    use crate::queries::analytics as a;
    use crate::queries::filters::range_start;
    let site: Option<(String, String, String)> = sqlx::query_as(
        "SELECT id, name, domain FROM sites WHERE share_token=$1 AND public_dashboard=true",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?;
    let Some((site_id, name, domain)) = site else {
        return Err(crate::error::AppError::NotFound);
    };
    let start = range_start(q.range.as_deref());
    let stats = a::overview(&state.db, &site_id, start, &[]).await?;
    let timeseries = a::timeseries(&state.db, &site_id, start, matches!(q.range.as_deref(), Some("24h")), &[]).await?;
    let top_pages = a::top_pages(&state.db, &site_id, start, 10, &[]).await?;
    let sources = a::referrers(&state.db, &site_id, start, 10, &[]).await?;
    let devices = a::device_breakdown(&state.db, &site_id, start).await?;
    let rev_source = a::revenue_by_source(&state.db, &site_id, start, &[]).await?;
    let rev_country = a::revenue_by_country(&state.db, &site_id, start, &[]).await?;
    let rev_ts = a::revenue_timeseries(&state.db, &site_id, start, matches!(q.range.as_deref(), Some("24h")), &[]).await?;
    let channels = a::channel_breakdown(&state.db, &site_id, start, &[]).await?;
    Ok(Json(json!({
        "data": {
            "site": { "name": name, "domain": domain },
            "dashboard": {
                "stats": stats, "timeseries": timeseries, "topPages": top_pages, "sources": sources,
                "devices": devices["devices"], "os": devices["os"], "browsers": devices["browsers"],
                "revenueBySource": rev_source, "revenueByCountry": rev_country, "revenueTimeseries": rev_ts, "channels": channels,
            }
        },
        "success": true
    })))
}

#[derive(serde::Deserialize)]
pub struct PublicDashQuery {
    pub range: Option<String>,
}

/// GET /api/klikapa.js — serve tracking script based on site plan (Growth → full, else core).
async fn klikapa_js(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<TrackerQuery>,
    headers: axum::http::HeaderMap,
) -> AppResult<impl IntoResponse> {
    let mut site_id = q.site_id.clone().unwrap_or_default();
    if site_id.is_empty() {
        if let Some(referer) = headers.get(axum::http::header::REFERER).and_then(|h| h.to_str().ok()) {
            if let Ok(u) = url::Url::parse(referer) {
                site_id = u.query_pairs().find(|(k, _)| k == "site_id").map(|(_, v)| v.to_string()).unwrap_or_default();
            }
        }
    }
    let mut is_full = false;
    if !site_id.is_empty() {
        let row: Option<(String,)> = sqlx::query_as("SELECT s.user_id FROM sites s WHERE s.id=$1")
            .bind(&site_id)
            .fetch_optional(&state.db)
            .await?;
        if let Some((user_id,)) = row {
            let (plan, _) = crate::services::plans::effective_plan(&state.db, &user_id).await;
            is_full = plan == "growth";
        }
    }
    let origin = std::env::var("REV_PUBLIC_ORIGIN").unwrap_or_else(|_| "".into());
    let target = if is_full { format!("{origin}/klikapa-full.js") } else { format!("{origin}/klikapa-core.js") };
    Ok(axum::response::Redirect::temporary(&target))
}

#[derive(serde::Deserialize)]
pub struct TrackerQuery {
    pub site_id: Option<String>,
}

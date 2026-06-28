use crate::error::AppResult;
use crate::middleware::auth::PublicAuth;
use crate::queries::analytics;
use crate::queries::filters::{parse_filters, range_start};
use crate::state::AppState;
use crate::web::{ok, ok_value};
use axum::extract::{Query, State};
use axum::response::Response;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct AQ {
    pub site_id: String,
    pub range: Option<String>,
    pub filters: Option<String>,
    pub limit: Option<i64>,
    pub format: Option<String>,
}

macro_rules! gate {
    ($s:expr, $auth:expr, $site_id:expr) => {
        crate::middleware::site_access::require(&$s.db, &$auth.0, $site_id).await
    };
}

pub async fn overview(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let v = analytics::overview(&s.db, &q.site_id, range_start(q.range.as_deref()), &filters).await?;
    Ok(ok(v))
}
pub async fn timeseries(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let hourly = matches!(q.range.as_deref(), Some("24h"));
    let v = analytics::timeseries(&s.db, &q.site_id, range_start(q.range.as_deref()), hourly, &filters).await?;
    Ok(ok_value(Value::Array(v)))
}
pub async fn pages(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let limit = q.limit.unwrap_or(10).min(100);
    let v = analytics::top_pages(&s.db, &q.site_id, range_start(q.range.as_deref()), limit, &filters).await?;
    Ok(ok_value(Value::Array(v)))
}
pub async fn referrers(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let limit = q.limit.unwrap_or(10).min(100);
    let v = analytics::referrers(&s.db, &q.site_id, range_start(q.range.as_deref()), limit, &filters).await?;
    Ok(ok_value(Value::Array(v)))
}
pub async fn geo(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let limit = q.limit.unwrap_or(50).min(500);
    let v = analytics::geo(&s.db, &q.site_id, range_start(q.range.as_deref()), limit, &filters).await?;
    Ok(ok_value(Value::Array(v)))
}
pub async fn devices(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let v = analytics::device_breakdown(&s.db, &q.site_id, range_start(q.range.as_deref())).await?;
    Ok(ok(v))
}
pub async fn revenue(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let start = range_start(q.range.as_deref());
    let by_source = analytics::revenue_by_source(&s.db, &q.site_id, start, &filters).await?;
    let by_country = analytics::revenue_by_country(&s.db, &q.site_id, start, &filters).await?;
    let ts = analytics::revenue_timeseries(&s.db, &q.site_id, start, matches!(q.range.as_deref(), Some("24h")), &filters).await?;
    Ok(ok(json!({ "bySource": by_source, "byCountry": by_country, "timeseries": ts })))
}
pub async fn campaigns(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let v = analytics::channel_breakdown(&s.db, &q.site_id, range_start(q.range.as_deref()), &filters).await?;
    Ok(ok_value(Value::Array(v)))
}
pub async fn export(auth: PublicAuth, State(s): State<AppState>, Query(q): Query<AQ>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let rows = analytics::export_events(&s.db, &q.site_id, range_start(q.range.as_deref()), 10_000).await?;
    Ok(ok_value(Value::Array(rows)))
}

use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::queries::analytics;
use crate::queries::filters::{parse_filters, range_start};
use crate::state::AppState;
use crate::web::ok;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
pub struct SiteRangeQuery {
    pub site_id: String,
    pub range: Option<String>,
    pub filters: Option<String>,
    pub limit: Option<i64>,
    #[allow(dead_code)]
    pub format: Option<String>,
}

fn auth_site(state: &AppState, auth: &Auth, site_id: &str) -> AppResult<()> {
    // blocking async check
    let db = state.db.clone();
    let auth = auth.clone();
    let site_id = site_id.to_string();
    // synchronous wrapper not possible; do it inline in callers instead.
    let _ = (db, auth, site_id);
    Ok(())
}
// (placeholder kept minimal; real check done via site_access::require in each handler)

macro_rules! gated {
    ($state:expr, $auth:expr, $site_id:expr) => {
        crate::middleware::site_access::require(&$state.db, &$auth, $site_id).await
    };
}

pub async fn dashboard(
    auth: Auth,
    State(state): State<AppState>,
    Query(q): Query<SiteRangeQuery>,
) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let start = range_start(q.range.as_deref());
    let filters = parse_filters(q.filters.as_deref());
    let hourly = matches!(q.range.as_deref(), Some("24h"));

    // Run all sub-queries concurrently (was sequential -> 9 round-trips in series).
    let (stats, timeseries, top_pages, sources, devices, rev_source, rev_country, rev_ts, channels) = tokio::try_join!(
        analytics::overview(&state.db, &q.site_id, start, &filters),
        analytics::timeseries(&state.db, &q.site_id, start, hourly, &filters),
        analytics::top_pages(&state.db, &q.site_id, start, 10, &filters),
        analytics::referrers(&state.db, &q.site_id, start, 10, &filters),
        analytics::device_breakdown(&state.db, &q.site_id, start),
        analytics::revenue_by_source(&state.db, &q.site_id, start, &filters),
        analytics::revenue_by_country(&state.db, &q.site_id, start, &filters),
        analytics::revenue_timeseries(&state.db, &q.site_id, start, hourly, &filters),
        analytics::channel_breakdown(&state.db, &q.site_id, start, &filters),
    )?;

    Ok(ok(json!({
        "stats": stats,
        "timeseries": timeseries,
        "topPages": top_pages,
        "sources": sources,
        "devices": devices["devices"],
        "os": devices["os"],
        "browsers": devices["browsers"],
        "revenueBySource": rev_source,
        "revenueByCountry": rev_country,
        "revenueTimeseries": rev_ts,
        "channels": channels,
    })))
}

pub async fn overview_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let v = analytics::overview(&state.db, &q.site_id, range_start(q.range.as_deref()), &filters).await?;
    Ok(ok(v))
}
pub async fn timeseries_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let v = analytics::timeseries(&state.db, &q.site_id, range_start(q.range.as_deref()), matches!(q.range.as_deref(), Some("24h")), &filters).await?;
    Ok(ok(json!(v)))
}
pub async fn pages_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let limit = q.limit.unwrap_or(10).min(100);
    let v = analytics::top_pages(&state.db, &q.site_id, range_start(q.range.as_deref()), limit, &filters).await?;
    Ok(ok(json!(v)))
}
pub async fn referrers_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let limit = q.limit.unwrap_or(10).min(100);
    let v = analytics::referrers(&state.db, &q.site_id, range_start(q.range.as_deref()), limit, &filters).await?;
    Ok(ok(json!(v)))
}
pub async fn geo_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let limit = q.limit.unwrap_or(50).min(500);
    let v = analytics::geo(&state.db, &q.site_id, range_start(q.range.as_deref()), limit, &filters).await?;
    Ok(ok(json!(v)))
}
pub async fn devices_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let v = analytics::device_breakdown(&state.db, &q.site_id, range_start(q.range.as_deref())).await?;
    Ok(ok(v))
}
pub async fn revenue_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let filters = parse_filters(q.filters.as_deref());
    let start = range_start(q.range.as_deref());
    let hourly = matches!(q.range.as_deref(), Some("24h"));
    let by_source = analytics::revenue_by_source(&state.db, &q.site_id, start, &filters).await?;
    let by_country = analytics::revenue_by_country(&state.db, &q.site_id, start, &filters).await?;
    let ts = analytics::revenue_timeseries(&state.db, &q.site_id, start, hourly, &filters).await?;
    Ok(ok(json!({ "bySource": by_source, "byCountry": by_country, "timeseries": ts })))
}
pub async fn sparkline_ep(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteRangeQuery>) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let v = analytics::sparkline(&state.db, &q.site_id, range_start(q.range.as_deref())).await?;
    Ok(ok(json!(v)))
}
pub async fn export_ep(
    auth: Auth,
    State(state): State<AppState>,
    Query(q): Query<SiteRangeQuery>,
) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    let rows = analytics::export_events(&state.db, &q.site_id, range_start(q.range.as_deref()), 10_000).await?;
    if q.format.as_deref() == Some("csv") {
        let cols = ["visitor_id","session_id","event_type","name","path","hostname","referrer","utm_source","utm_medium","utm_campaign","country","region","city","device_type","browser","os","revenue","timestamp"];
        let csv = crate::queries::filters::to_csv(&rows, &cols);
        let mut resp = axum::response::Response::new(axum::body::Body::from(csv));
        let h = resp.headers_mut();
        h.insert(axum::http::header::CONTENT_TYPE, axum::http::HeaderValue::from_static("text/csv"));
        h.insert(axum::http::header::CONTENT_DISPOSITION, axum::http::HeaderValue::from_static("attachment; filename=\"events.csv\""));
        Ok(resp)
    } else {
        Ok(ok(json!(rows)))
    }
}

// SSE real-time stream: polls recent events every 2.5s via a spawned task + channel.
pub async fn stream_ep(
    auth: Auth,
    State(state): State<AppState>,
    Query(q): Query<SiteRangeQuery>,
) -> AppResult<Response> {
    gated!(state, auth, &q.site_id)?;
    use axum::response::sse::{Event, KeepAlive, Sse};
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(8);
    let db = state.db.clone();
    let site_id = q.site_id.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(2500));
        let mut since = chrono::Utc::now() - chrono::Duration::minutes(5);
        loop {
            interval.tick().await;
            let now = chrono::Utc::now();
            let rows = sqlx::query(
                "SELECT id, visitor_id, event_type, name, path, country, browser \
                 FROM events WHERE site_id=$1 AND timestamp > $2 ORDER BY timestamp ASC LIMIT 50",
            )
            .bind(&site_id).bind(since).fetch_all(&db).await;
            since = now;
            let live: i64 = sqlx::query_as(
                "SELECT COUNT(DISTINCT visitor_id) FROM events WHERE site_id=$1 AND timestamp > NOW() - interval '5 minutes'",
            )
            .bind(&site_id).fetch_one(&db).await.map(|(c,)| c).unwrap_or(0);

            let payload = match rows {
                Ok(r) => serde_json::json!({
                    "events": r.iter().map(|row| serde_json::json!({
                        "id": crate::queries::row_str(row, 0),
                        "visitor_id": crate::queries::row_str(row, 1),
                        "event_type": crate::queries::row_str(row, 2),
                        "name": crate::queries::row_str(row, 3),
                        "path": crate::queries::row_str(row, 4),
                        "country": crate::queries::row_str(row, 5),
                        "browser": crate::queries::row_str(row, 6),
                    })).collect::<Vec<_>>(),
                    "live_visitors": live,
                }),
                Err(_) => serde_json::json!({ "events": [], "live_visitors": live }),
            };
            let ev = Event::default().data(payload.to_string());
            if tx.send(Ok(ev)).await.is_err() {
                break; // client disconnected
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

// prevent unused import of AppError
#[allow(dead_code)]
fn _e() -> AppError { AppError::NotFound }


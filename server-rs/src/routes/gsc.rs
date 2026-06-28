use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::state::AppState;
use crate::web::{new_id, ok};
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

fn origin() -> String {
    std::env::var("REV_PUBLIC_ORIGIN").unwrap_or_else(|_| "https://api.example.com".into())
}

#[derive(Deserialize)]
pub struct SiteQuery {
    pub site_id: Option<String>,
}

// GET /gsc/auth?site_id=
pub async fn auth(State(state): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    let client_id = state.config.google_client_id.clone().unwrap_or_default();
    let redirect = format!("{}/api/gsc/callback", origin());
    let state_param = json!({ "site_id": q.site_id, "nonce": new_id() }).to_string();
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={cid}&redirect_uri={ru}&response_type=code&scope={sc}&access_type=offline&prompt=consent&state={st}",
        cid = ue(&client_id), ru = ue(&redirect), sc = ue("https://www.googleapis.com/auth/webmasters.readonly"), st = ue(&state_param)
    );
    Ok(Redirect::temporary(&url).into_response())
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
}

// GET /gsc/callback
pub async fn callback(State(state): State<AppState>, Query(q): Query<CallbackQuery>) -> AppResult<Response> {
    let code = q.code.as_deref().ok_or_else(|| AppError::bad_request("Missing code"))?;
    let st: Value = serde_json::from_str(q.state.as_deref().unwrap_or("{}")).unwrap_or(Value::Null);
    let site_id = st.get("site_id").and_then(|v| v.as_str()).unwrap_or("");

    let cid = state.config.google_client_id.clone().unwrap_or_default();
    let secret = state.config.google_client_secret.clone().unwrap_or_default();
    let redirect = format!("{}/api/gsc/callback", origin());
    let form = [("code", code), ("client_id", cid.as_str()), ("client_secret", secret.as_str()), ("redirect_uri", redirect.as_str()), ("grant_type", "authorization_code")];
    let token_res: Value = state.http.post("https://oauth2.googleapis.com/token").form(&form).send().await
        .map_err(|e| AppError::internal(format!("gsc token: {e}")))?
        .json().await.map_err(|e| AppError::internal(format!("gsc token parse: {e}")))?;
    if token_res.get("error").is_some() {
        return Err(AppError::bad_request("gsc oauth error"));
    }
    let access_token = token_res.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let refresh_token = token_res.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("");

    // Store as integration of type "gsc" (config holds tokens + site_url resolved later).
    let cfg = json!({ "access_token": access_token, "refresh_token": refresh_token, "google_site_url": "" });
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM integrations WHERE site_id=$1 AND type='gsc'")
        .bind(site_id).fetch_optional(&state.db).await?;
    if let Some(id) = existing {
        sqlx::query("UPDATE integrations SET config=$1, last_sync=now() WHERE id=$2").bind(&cfg).bind(&id).execute(&state.db).await?;
    } else {
        sqlx::query("INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled, last_sync, created_at) VALUES ($1,$2,'','gsc','Google Search Console',$3,true,now(),now())")
            .bind(new_id()).bind(site_id).bind(&cfg).execute(&state.db).await?;
    }
    Ok(Redirect::temporary(&format!("{}/integrations", origin())).into_response())
}

// GET /gsc/queries?site_id=&range=
pub async fn queries(auth: Auth, State(state): State<AppState>, Query(q): Query<crate::routes::analytics::SiteRangeQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&state.db, &auth, &q.site_id).await?;
    let start = crate::queries::filters::range_start(q.range.as_deref());
    let rows: Vec<(String, chrono::NaiveDate, i64, i64, f64, f64)> = sqlx::query_as(
        "SELECT query, date, clicks, impressions, ctr, position FROM search_console_data \
         WHERE site_id=$1 AND date>=$2 ORDER BY date DESC, clicks DESC LIMIT 500",
    )
    .bind(&q.site_id).bind(start.date_naive()).fetch_all(&state.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(q,d,c,i,ctr,pos)| json!({"query":q,"date":d,"clicks":c,"impressions":i,"ctr":ctr,"position":pos})).collect::<Vec<_>>())))
}

// POST /gsc/sync?site_id=  — sync last 7 days (2-day GSC latency) per-day.
pub async fn sync(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    let site_id = q.site_id.as_deref().ok_or_else(|| AppError::bad_request("site_id required"))?;
    crate::middleware::site_access::require(&state.db, &auth, site_id).await?;
    let cfg: Option<Value> = sqlx::query_scalar("SELECT config FROM integrations WHERE site_id=$1 AND type='gsc'")
        .bind(site_id).fetch_optional(&state.db).await?;
    let cfg = cfg.ok_or_else(|| AppError::NotFound)?;
    let access_token = cfg.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let site_url = cfg.get("google_site_url").and_then(|v| v.as_str()).unwrap_or("");
    if access_token.is_empty() || site_url.is_empty() {
        return Err(AppError::bad_request("GSC not fully configured (missing token or site_url)"));
    }
    let enc = ue(site_url);
    let mut synced = 0i64;
    for days_ago in 2..9 {
        let d = Utc::now() - chrono::Duration::days(days_ago);
        let ds = d.format("%Y-%m-%d").to_string();
        let body = json!({ "startDate": ds, "endDate": ds, "dimensions": ["query"], "rowLimit": 1000 });
        let url = format!("https://www.googleapis.com/webmasters/v3/sites/{enc}/searchAnalytics/query");
        let res: Value = match state.http.post(&url).bearer_auth(access_token).json(&body).send().await {
            Ok(r) => r.json().await.unwrap_or(Value::Null),
            Err(_) => continue,
        };
        if let Some(rows) = res.get("rows").and_then(|v| v.as_array()) {
            for row in rows {
                let q = row.pointer("/keys/0").and_then(|v| v.as_str()).unwrap_or("");
                let clicks = row.get("clicks").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
                let imp = row.get("impressions").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
                let ctr = row.get("ctr").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let pos = row.get("position").and_then(|v| v.as_f64()).unwrap_or(0.0);
                sqlx::query("INSERT INTO search_console_data (id, site_id, date, query, clicks, impressions, ctr, position, fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT DO NOTHING")
                    .bind(new_id()).bind(site_id).bind(d.date_naive()).bind(q).bind(clicks).bind(imp).bind(ctr).bind(pos).execute(&state.db).await?;
                synced += 1;
            }
        }
    }
    Ok(ok(json!({ "synced": synced })))
}

fn ue(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

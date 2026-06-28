use crate::error::{AppError, AppResult};
use crate::middleware::auth::{AdminAuth, Auth};
use crate::state::AppState;
use crate::web::{created, new_id, ok};
use axum::extract::{Path, Query, State};
use axum::response::Response;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

const VALID_INTEGRATION_TYPES: &[&str] = &["mailchimp", "convertkit", "kit", "beehiiv", "meta_ads", "google_ads", "gsc", "shopee", "tokopedia"];
const SENSITIVE_KEYS: &[&str] = &["api_key", "api_secret", "access_token", "client_secret", "refresh_token", "secret"];

fn mask(v: &Value) -> Value {
    if let Some(obj) = v.as_object() {
        let mut out = serde_json::Map::new();
        for (k, val) in obj {
            if SENSITIVE_KEYS.contains(&k.as_str()) {
                let s = val.as_str().unwrap_or("");
                out.insert(k.clone(), Value::String(if s.len() <= 4 { "****".into() } else { format!("****{}", &s[s.len() - 4..]) }));
            } else {
                out.insert(k.clone(), val.clone());
            }
        }
        Value::Object(out)
    } else {
        v.clone()
    }
}

// ---------- team ----------
#[derive(Deserialize)]
pub struct SiteQuery { site_id: String }

pub async fn team_list(auth: Auth, State(s): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    let rows: Vec<(String,String,String,Option<chrono::DateTime<Utc>>,Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
        "SELECT t.id, t.role, u.email, t.invited_at, t.accepted_at FROM team_members t JOIN users u ON u.id=t.user_id WHERE t.site_id=$1")
        .bind(&q.site_id).fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,role,email,invited,accepted)| json!({"id":id,"role":role,"email":email,"invited_at":invited,"accepted_at":accepted})).collect::<Vec<_>>())))
}
#[derive(Deserialize)]
pub struct InviteReq { site_id: String, email: String, role: Option<String> }
pub async fn team_invite(auth: Auth, State(s): State<AppState>, body: axum::Json<InviteReq>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    let uid: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1").bind(&body.email).fetch_optional(&s.db).await?;
    let uid = uid.ok_or_else(|| AppError::NotFound)?;
    let role = body.role.clone().unwrap_or_else(|| "viewer".into());
    let id = new_id();
    sqlx::query("INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES ($1,$2,$3,$4,$5,now(),now()) ON CONFLICT (site_id, user_id) DO UPDATE SET role=EXCLUDED.role")
        .bind(&id).bind(&body.site_id).bind(&uid).bind(&role).bind(&auth.user_id).execute(&s.db).await?;
    Ok(created(json!({"id":id,"role":role,"email":body.email})))
}
#[derive(Deserialize)]
pub struct UpdateRole { site_id: String, role: String }
pub async fn team_update(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, body: axum::Json<UpdateRole>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    sqlx::query("UPDATE team_members SET role=$1 WHERE id=$2").bind(&body.role).bind(&id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"role":body.role})))
}
pub async fn team_remove(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    sqlx::query("DELETE FROM team_members WHERE id=$1 AND site_id=$2").bind(&id).bind(&q.site_id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"removed":true})))
}

// ---------- email_reports ----------
pub async fn report_list(auth: Auth, State(s): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    let rows: Vec<(String,String,bool,Option<chrono::DateTime<Utc>>)> = sqlx::query_as("SELECT id, frequency, enabled, last_sent FROM email_reports WHERE site_id=$1 AND user_id=$2")
        .bind(&q.site_id).bind(&auth.user_id).fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,freq,en,ls)| json!({"id":id,"frequency":freq,"enabled":en,"last_sent":ls})).collect::<Vec<_>>())))
}
#[derive(Deserialize)] pub struct CreateReport { site_id: String, frequency: Option<String> }
pub async fn report_create(auth: Auth, State(s): State<AppState>, body: axum::Json<CreateReport>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    let id = new_id();
    let freq = body.frequency.clone().unwrap_or_else(|| "weekly".into());
    sqlx::query("INSERT INTO email_reports (id, site_id, user_id, frequency, enabled, created_at) VALUES ($1,$2,$3,$4,true,now())")
        .bind(&id).bind(&body.site_id).bind(&auth.user_id).bind(&freq).execute(&s.db).await?;
    Ok(created(json!({"id":id,"frequency":freq,"enabled":true})))
}
pub async fn report_update(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, body: axum::Json<Value>) -> AppResult<Response> {
    let enabled = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let freq = body.get("frequency").and_then(|v| v.as_str());
    let site_id = body.get("site_id").and_then(|v| v.as_str()).unwrap_or("");
    crate::middleware::site_access::require(&s.db, &auth, site_id).await?;
    if let Some(f) = freq {
        sqlx::query("UPDATE email_reports SET frequency=$1, enabled=$2 WHERE id=$3 AND user_id=$4").bind(f).bind(enabled).bind(&id).bind(&auth.user_id).execute(&s.db).await?;
    } else {
        sqlx::query("UPDATE email_reports SET enabled=$1 WHERE id=$2 AND user_id=$3").bind(enabled).bind(&id).bind(&auth.user_id).execute(&s.db).await?;
    }
    Ok(ok(json!({"id":id,"enabled":enabled})))
}
pub async fn report_delete(auth: Auth, State(s): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    sqlx::query("DELETE FROM email_reports WHERE id=$1 AND user_id=$2").bind(&id).bind(&auth.user_id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"deleted":true})))
}

// ---------- integrations ----------
pub async fn int_list(auth: Auth, State(s): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    let rows: Vec<(String,String,String,bool,Option<chrono::DateTime<Utc>>)> = sqlx::query_as("SELECT id, type, name, enabled, last_sync FROM integrations WHERE site_id=$1")
        .bind(&q.site_id).fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,t,n,en,ls)| json!({"id":id,"type":t,"name":n,"enabled":en,"last_sync":ls})).collect::<Vec<_>>())))
}
#[derive(Deserialize)] pub struct CreateInt { site_id: String, #[serde(rename="type")] kind: String, name: String, config: Value }
pub async fn int_create(auth: Auth, State(s): State<AppState>, body: axum::Json<CreateInt>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    if !VALID_INTEGRATION_TYPES.contains(&body.kind.as_str()) { return Err(AppError::bad_request("Invalid integration type")); }
    let id = new_id();
    sqlx::query("INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled, created_at) VALUES ($1,$2,$3,$4,$5,$6,true,now())")
        .bind(&id).bind(&body.site_id).bind(&auth.user_id).bind(&body.kind).bind(&body.name).bind(mask(&body.config)).execute(&s.db).await?;
    Ok(created(json!({"id":id,"type":body.kind,"name":body.name})))
}
pub async fn int_update(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, body: axum::Json<Value>) -> AppResult<Response> {
    let site_id = body.get("site_id").and_then(|v| v.as_str()).unwrap_or("");
    crate::middleware::site_access::require(&s.db, &auth, site_id).await?;
    let config = body.get("config").cloned().map(|c| mask(&c));
    let enabled = body.get("enabled").and_then(|v| v.as_bool());
    let mut q = String::from("UPDATE integrations SET ");
    let mut binds: Vec<(String, Value)> = vec![];
    if let Some(c) = config { binds.push(("config".into(), c)); }
    if let Some(e) = enabled { binds.push(("enabled".into(), json!(e))); }
    if binds.is_empty() { return Ok(ok(json!({"id":id}))); }
    let sets: Vec<String> = binds.iter().enumerate().map(|(i,(col,_))| format!("{col}=${}", i+1)).collect();
    q.push_str(&sets.join(","));
    q.push_str(&format!(" WHERE id=${}", binds.len()+1));
    let mut query = sqlx::query(&q);
    for (_, v) in &binds { query = query.bind(v); }
    query = query.bind(&id);
    query.execute(&s.db).await?;
    Ok(ok(json!({"id":id})))
}
pub async fn int_delete(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    sqlx::query("DELETE FROM webhook_events WHERE integration_id=$1").bind(&id).execute(&s.db).await?;
    sqlx::query("DELETE FROM integrations WHERE id=$1").bind(&id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"deleted":true})))
}

// ---------- payment_providers ----------
pub async fn pp_list(auth: Auth, State(s): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    let rows: Vec<(String,String,bool)> = sqlx::query_as("SELECT id, provider, enabled FROM payment_providers WHERE site_id=$1").bind(&q.site_id).fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,p,en)| json!({"id":id,"provider":p,"enabled":en,"config":Value::Null})).collect::<Vec<_>>())))
}
#[derive(Deserialize)] pub struct CreatePP { site_id: String, provider: String, config: Value }
pub async fn pp_create(auth: Auth, State(s): State<AppState>, body: axum::Json<CreatePP>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    let id = new_id();
    sqlx::query("INSERT INTO payment_providers (id, site_id, provider, config, enabled, created_at) VALUES ($1,$2,$3,$4,true,now())")
        .bind(&id).bind(&body.site_id).bind(&body.provider).bind(mask(&body.config)).execute(&s.db).await?;
    Ok(created(json!({"id":id,"provider":body.provider})))
}
pub async fn pp_delete(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    sqlx::query("DELETE FROM payment_providers WHERE id=$1 AND site_id=$2").bind(&id).bind(&q.site_id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"deleted":true})))
}

// ---------- admin ----------
pub async fn admin_stats(_auth: AdminAuth, State(s): State<AppState>) -> AppResult<Response> {
    let users: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users").fetch_one(&s.db).await?;
    let sites: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sites").fetch_one(&s.db).await?;
    let events: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events").fetch_one(&s.db).await?;
    let subs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM subscriptions WHERE status IN ('active','trialing')").fetch_one(&s.db).await?;
    Ok(ok(json!({"users":users.0,"sites":sites.0,"events":events.0,"subscriptions":subs.0})))
}
pub async fn admin_users(_auth: AdminAuth, State(s): State<AppState>) -> AppResult<Response> {
    let rows: Vec<(String,String,String,chrono::DateTime<Utc>)> = sqlx::query_as("SELECT id, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 500")
        .fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,email,role,created_at)| json!({"id":id,"email":email,"role":role,"created_at":created_at})).collect::<Vec<_>>())))
}

// ---------- import ----------
#[derive(Deserialize)]
pub struct PolarImport { site_id: String }
pub async fn import_polar(auth: Auth, State(s): State<AppState>, body: axum::Json<PolarImport>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    let polar = crate::services::polar::Polar::from_state(&s);
    let since = (Utc::now() - chrono::Duration::days(90)).to_rfc3339();
    let orders = polar.list_orders_since(&since).await.unwrap_or_default();
    let mut imported = 0i64;
    let mut skipped = 0i64;
    for o in &orders {
        if o.get("status").and_then(|v| v.as_str()) != Some("paid") { continue; }
        match crate::services::polar::process_polar_order(&s.db, o, &body.site_id).await {
            Ok("imported") => imported += 1,
            _ => skipped += 1,
        }
    }
    Ok(ok(json!({"imported":imported,"skipped":skipped})))
}

// ---------- import: onedollarstats ----------
/// POST /api/import/onedollarstats — fetch aggregated ODS data, create synthetic pageviews.
pub async fn import_onedollarstats(auth: Auth, State(s): State<AppState>, body: axum::Json<OneDollarReq>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &body.site_id).await?;
    let api_key = body.api_key.clone();
    let ods_site = body.ods_site_id.clone();
    let start = body.date_range.clone().unwrap_or_else(|| "all".into());
    let client = &s.http;
    let mut imported = 0i64;
    for endpoint in ["pageviews", "country", "source"] {
        let url = format!("https://api.onedollarstats.com/v1/{}/?site_id={}&api_key={}&date_range={}", endpoint, ue(&ods_site), ue(&api_key), ue(&start));
        let res: Value = match client.get(&url).send().await { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(_) => continue };
        let rows = res.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for row in rows {
            let path = row.get("path").or_else(|| row.get("url")).and_then(|v| v.as_str()).unwrap_or("/").to_string();
            let visitors = row.get("visitors").or_else(|| row.get("count")).and_then(|v| v.as_i64()).unwrap_or(0);
            let country = row.get("country").and_then(|v| v.as_str()).map(String::from);
            let source = row.get("source").and_then(|v| v.as_str()).map(String::from);
            let n = visitors.min(50);
            for i in 0..n {
                let vid = format!("ods_{}_{}_{}", chrono::Utc::now().format("%Y%m%d"), path, i);
                let ts = chrono::Utc::now() - chrono::Duration::seconds(i * 60);
                let props = json!({ "source": "onedollarstats_import", "country": country, "utm_source": source });
                sqlx::query("INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, country, utm_source, props) VALUES ($1,$2,$3,$4,$5,'pageview',$6,$7,$8,$9)")
                    .bind(new_id()).bind(&body.site_id).bind(&vid).bind(&vid).bind(ts).bind(&path).bind(&country).bind(&source).bind(&props).execute(&s.db).await?;
                imported += 1;
            }
        }
    }
    Ok(ok(json!({ "imported": imported })))
}

#[derive(Deserialize)]
pub struct OneDollarReq {
    site_id: String,
    api_key: String,
    ods_site_id: String,
    date_range: Option<String>,
}

fn ue(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

// ---------- docs ----------
pub async fn docs() -> AppResult<Response> {
    Ok(ok(json!({
        "base": "/api",
        "auth": ["/api/auth/register","/api/auth/login","/api/auth/me","/api/auth/google"],
        "sites": ["/api/sites","/api/sites/:id","/api/sites/:id/snippet"],
        "track": ["/api/track","/api/identify","/api/track/heatmap","/api/track/recording","/api/track/payment"],
        "analytics": ["/api/analytics/dashboard","/api/analytics/overview","/api/analytics/timeseries","/api/analytics/stream","/api/analytics/export"],
        "public_api_v1": "/api/v1/* (rvt_/rv_ tokens)"
    })))
}

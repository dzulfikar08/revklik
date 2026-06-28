use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::state::AppState;
use crate::web::{created, new_id, ok};
use axum::extract::{Path, Query, State};
use axum::response::Response;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

macro_rules! gate {
    ($s:expr, $auth:expr, $site_id:expr) => {
        crate::middleware::site_access::require(&$s.db, &$auth, $site_id).await
    };
}

// ---------- segments ----------
#[derive(Deserialize)] pub struct SiteQuery { site_id: String }
pub async fn list_segments(auth: Auth, State(s): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let rows: Vec<(String, String, Value, chrono::DateTime<Utc>)> = sqlx::query_as("SELECT id, name, filters, created_at FROM segments WHERE site_id=$1 ORDER BY created_at DESC")
        .bind(&q.site_id).fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,name,filters,created_at)| json!({"id":id,"name":name,"filters":filters,"created_at":created_at})).collect::<Vec<_>>())))
}
#[derive(Deserialize)] pub struct CreateSeg { site_id: String, name: String, filters: Value }
pub async fn create_segment(auth: Auth, State(s): State<AppState>, axum::Json(b): axum::Json<CreateSeg>) -> AppResult<Response> {
    gate!(s, auth, &b.site_id)?;
    let id = new_id();
    sqlx::query("INSERT INTO segments (id, site_id, name, filters, created_at) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&b.site_id).bind(&b.name).bind(&b.filters).bind(Utc::now()).execute(&s.db).await?;
    Ok(created(json!({"id":id,"name":b.name,"filters":b.filters})))
}
pub async fn delete_segment(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    sqlx::query("DELETE FROM segments WHERE id=$1 AND site_id=$2").bind(&id).bind(&q.site_id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"deleted":true})))
}

// ---------- annotations ----------
pub async fn list_annotations(auth: Auth, State(s): State<AppState>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let rows: Vec<(String, chrono::NaiveDate, String, chrono::DateTime<Utc>)> = sqlx::query_as("SELECT id, date, text, created_at FROM annotations WHERE site_id=$1 ORDER BY date DESC")
        .bind(&q.site_id).fetch_all(&s.db).await?;
    Ok(ok(json!(rows.into_iter().map(|(id,date,text,created_at)| json!({"id":id,"date":date,"text":text,"created_at":created_at})).collect::<Vec<_>>())))
}
#[derive(Deserialize)] pub struct CreateAnn { site_id: String, date: chrono::NaiveDate, text: String }
pub async fn create_annotation(auth: Auth, State(s): State<AppState>, axum::Json(b): axum::Json<CreateAnn>) -> AppResult<Response> {
    gate!(s, auth, &b.site_id)?;
    let id = new_id();
    sqlx::query("INSERT INTO annotations (id, site_id, date, text, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&id).bind(&b.site_id).bind(&b.date).bind(&b.text).bind(&auth.user_id).bind(Utc::now()).execute(&s.db).await?;
    Ok(created(json!({"id":id,"date":b.date,"text":b.text})))
}
pub async fn delete_annotation(auth: Auth, State(s): State<AppState>, Path(id): Path<String>, Query(q): Query<SiteQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    sqlx::query("DELETE FROM annotations WHERE id=$1 AND site_id=$2").bind(&id).bind(&q.site_id).execute(&s.db).await?;
    Ok(ok(json!({"id":id,"deleted":true})))
}

// ---------- push_tokens ----------
#[derive(Deserialize)] pub struct PushReg { device_token: String, platform: String }
pub async fn register_push(auth: Auth, State(s): State<AppState>, axum::Json(b): axum::Json<PushReg>) -> AppResult<Response> {
    sqlx::query("INSERT INTO push_tokens (id, user_id, device_token, platform, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (device_token) DO UPDATE SET user_id=EXCLUDED.user_id")
        .bind(new_id()).bind(&auth.user_id).bind(&b.device_token).bind(&b.platform).bind(Utc::now()).execute(&s.db).await?;
    Ok(ok(json!({"success":true})))
}
pub async fn unregister_push(auth: Auth, State(s): State<AppState>, axum::Json(b): axum::Json<PushReg>) -> AppResult<Response> {
    sqlx::query("DELETE FROM push_tokens WHERE device_token=$1 AND user_id=$2").bind(&b.device_token).bind(&auth.user_id).execute(&s.db).await?;
    Ok(ok(json!({"success":true})))
}

// ---------- share (public dashboard toggle) ----------
pub async fn share_toggle(auth: Auth, State(s): State<AppState>, Path(site_id): Path<String>) -> AppResult<Response> {
    gate!(s, auth, &site_id)?;
    let row: Option<(Option<String>, bool)> = sqlx::query_as("SELECT share_token, public_dashboard FROM sites WHERE id=$1").bind(&site_id).fetch_one(&s.db).await.ok();
    if let Some((Some(token), _)) = row { return Ok(ok(json!({"share_token":token,"public_dashboard":true}))); }
    let token = format!("st_{}", crate::web::random_token(20));
    sqlx::query("UPDATE sites SET share_token=$1, public_dashboard=true WHERE id=$2").bind(&token).bind(&site_id).execute(&s.db).await?;
    Ok(ok(json!({"share_token":token,"public_dashboard":true})))
}
pub async fn share_status(auth: Auth, State(s): State<AppState>, Path(site_id): Path<String>) -> AppResult<Response> {
    gate!(s, auth, &site_id)?;
    let row: Option<(Option<String>, bool)> = sqlx::query_as("SELECT share_token, public_dashboard FROM sites WHERE id=$1").bind(&site_id).fetch_one(&s.db).await.ok();
    let (token, pubd) = row.unwrap_or((None, false));
    Ok(ok(json!({"share_token":token,"public_dashboard":pubd})))
}

// ---------- affiliates ----------
pub async fn affiliate_me(auth: Auth, State(s): State<AppState>) -> AppResult<Response> {
    let row: Option<(String,String,f64,f64,f64,String)> = sqlx::query_as("SELECT id, referral_code, commission_rate, total_earned, total_paid, status FROM affiliates WHERE user_id=$1")
        .bind(&auth.user_id).fetch_optional(&s.db).await?;
    Ok(ok(json!(row)))
}
pub async fn affiliate_generate(auth: Auth, State(s): State<AppState>) -> AppResult<Response> {
    let code = crate::web::random_token(8);
    let id = new_id();
    sqlx::query("INSERT INTO affiliates (id, user_id, referral_code, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET referral_code=EXCLUDED.referral_code")
        .bind(&id).bind(&auth.user_id).bind(&code).bind(Utc::now()).execute(&s.db).await?;
    Ok(ok(json!({"referral_code":code})))
}

// ---------- widget-data (lightweight stats for home screen, API-key auth) ----------
pub async fn widget_data(auth: Auth, State(s): State<AppState>, Query(q): Query<crate::routes::analytics::SiteRangeQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&s.db, &auth, &q.site_id).await?;
    let start = crate::queries::filters::range_start(q.range.as_deref());
    let (pv, vis, rev): (i64, i64, f64) = sqlx::query_as("SELECT COUNT(*)::bigint FILTER (WHERE event_type='pageview'), COUNT(DISTINCT visitor_id)::bigint, COALESCE(SUM(revenue),0)::float8 FROM events WHERE site_id=$1 AND timestamp>=$2")
        .bind(&q.site_id).bind(start).fetch_one(&s.db).await?;
    Ok(ok(json!({ "pageviews": pv, "visitors": vis, "revenue": rev })))
}

// keep AppError referenced
#[allow(dead_code)] fn _e() -> AppError { AppError::NotFound }

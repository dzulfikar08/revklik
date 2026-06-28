use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::services::plans::effective_plan;
use crate::state::AppState;
use crate::web::{new_id, ok, ok_value, random_token};
use axum::extract::{Path, Query, State};
use axum::response::Response;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct ListQuery {
    pub range: Option<String>,
}

fn range_start(range: Option<&str>) -> chrono::DateTime<Utc> {
    let r = range.unwrap_or("7d");
    if let Some(custom) = r.strip_prefix(|_| r.contains(',')) {
        if let Some(start) = r.split(',').next() {
            if let Ok(d) = chrono::DateTime::parse_from_rfc3339(start) {
                return d.with_timezone(&Utc);
            }
        }
        let _ = custom;
    }
    let days: i64 = match r {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        "90d" => 90,
        _ => 7,
    };
    Utc::now() - chrono::Duration::days(days)
}

pub async fn list(
    auth: Auth,
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> AppResult<Response> {
    let db = &state.db;
    let rows: Vec<(String, String, String, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, name, domain, created_at FROM sites WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(&auth.user_id)
    .fetch_all(db)
    .await?;

    let start = range_start(q.range.as_deref());
    let mut out = Vec::with_capacity(rows.len());
    for (id, name, domain, created_at) in rows {
        let stats: Option<(i64, i64, Option<f64>)> = sqlx::query_as(
            "SELECT COUNT(id), COUNT(DISTINCT visitor_id), SUM(revenue) FROM events \
             WHERE site_id = $1 AND event_type = 'pageview' AND timestamp >= $2",
        )
        .bind(&id)
        .bind(start)
        .fetch_optional(db)
        .await?;
        let (pageviews, visitors, revenue) = stats.unwrap_or((0, 0, None));

        let spark: Vec<(i64,)> = sqlx::query_as(
            "SELECT COUNT(id)::bigint FROM events WHERE site_id = $1 AND event_type = 'pageview' AND timestamp >= $2 \
             GROUP BY date_trunc('day', timestamp) ORDER BY date_trunc('day', timestamp) ASC",
        )
        .bind(&id)
        .bind(start)
        .fetch_all(db)
        .await?;
        let sparkline: Vec<i64> = spark.into_iter().map(|(c,)| c).collect();

        out.push(json!({
            "id": id, "name": name, "domain": domain, "created_at": created_at,
            "pageviews": pageviews, "visitors": visitors, "revenue": revenue.unwrap_or(0.0),
            "sparkline": sparkline,
        }));
    }
    Ok(ok_value(Value::Array(out)))
}

#[derive(Deserialize)]
pub struct CreateReq {
    pub name: String,
    pub domain: String,
}

pub async fn create(
    auth: Auth,
    State(state): State<AppState>,
    axum::Json(body): axum::Json<CreateReq>,
) -> AppResult<Response> {
    let db = &state.db;
    if body.name.trim().is_empty() || body.domain.trim().is_empty() {
        return Err(AppError::bad_request("Name and domain required"));
    }

    let (plan, is_super) = effective_plan(db, &auth.user_id).await;
    if !is_super {
        let limits = crate::services::plans::plan_def(&plan);
        let count: (i64,) = sqlx::query_as("SELECT COUNT(id) FROM sites WHERE user_id = $1")
            .bind(&auth.user_id)
            .fetch_one(db)
            .await?;
        if count.0 >= limits.sites {
            return Err(AppError::Forbidden(format!(
                "Site limit reached ({} for {} plan). Upgrade to create more sites.",
                limits.sites, limits.name
            )));
        }
    }

    let site_id = new_id();
    let share_token = format!("st_{}", random_token(20));
    sqlx::query(
        "INSERT INTO sites (id, user_id, name, domain, share_token, public_dashboard, created_at) \
         VALUES ($1,$2,$3,$4,$5,false,$6)",
    )
    .bind(&site_id)
    .bind(&auth.user_id)
    .bind(&body.name)
    .bind(&body.domain)
    .bind(&share_token)
    .bind(Utc::now())
    .execute(db)
    .await?;

    Ok(crate::web::created(json!({
        "id": site_id, "name": body.name, "domain": body.domain, "created_at": Utc::now()
    })))
}

pub async fn delete(
    auth: Auth,
    State(state): State<AppState>,
    Path(site_id): Path<String>,
) -> AppResult<Response> {
    let db = &state.db;
    let owned: Option<(String,)> = sqlx::query_as("SELECT id FROM sites WHERE id = $1 AND user_id = $2")
        .bind(&site_id)
        .bind(&auth.user_id)
        .fetch_optional(db)
        .await?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }
    sqlx::query("DELETE FROM events WHERE site_id = $1").bind(&site_id).execute(db).await?;
    sqlx::query("DELETE FROM sessions WHERE site_id = $1").bind(&site_id).execute(db).await?;
    sqlx::query("DELETE FROM visitor_profiles WHERE site_id = $1").bind(&site_id).execute(db).await?;
    sqlx::query("DELETE FROM sites WHERE id = $1").bind(&site_id).execute(db).await?;
    Ok(ok(json!({ "success": true })))
}

pub async fn snippet(
    auth: Auth,
    State(state): State<AppState>,
    Path(site_id): Path<String>,
) -> AppResult<Response> {
    let db = &state.db;
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT id, name, domain FROM sites WHERE id = $1 AND user_id = $2")
            .bind(&site_id)
            .bind(&auth.user_id)
            .fetch_optional(db)
            .await?;
    if row.is_none() {
        return Err(AppError::NotFound);
    }
    let origin = format!("https://{}", "api.example.com"); // overridden by config in prod
    let snippet = format!(
        "<script src=\"{origin}/klikapa.js\"></script>\n<script>\n  window.klikapa_site_id = \"{site_id}\";\n  window.klikapa_endpoint = \"{origin}/api/track\";\n</script>"
    );
    Ok(ok(json!({ "siteId": site_id, "snippet": snippet })))
}

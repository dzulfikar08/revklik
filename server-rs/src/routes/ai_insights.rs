use crate::error::AppResult;
use crate::middleware::auth::Auth;
use crate::queries::analytics;
use crate::queries::filters::{parse_filters, range_start};
use crate::services::llm::{heuristic_insights, Llm};
use crate::state::AppState;
use crate::web::{new_id, ok};
use axum::extract::{Query, State};
use axum::response::Response;
use chrono::Utc;
use serde_json::{json, Value};

#[derive(serde::Deserialize)]
pub struct InsightQuery {
    pub site_id: String,
    pub range: Option<String>,
}

/// TTL by range (ai-prompts.ts): 90d->24h, 30d->12h, else 4h.
fn ttl_hours(range: &str) -> i64 {
    match range {
        "90d" => 24,
        "30d" => 12,
        _ => 4,
    }
}

pub async fn insights(auth: Auth, State(state): State<AppState>, Query(q): Query<InsightQuery>) -> AppResult<Response> {
    crate::middleware::site_access::require(&state.db, &auth, &q.site_id).await?;
    let range = q.range.clone().unwrap_or_else(|| "7d".into());
    let start = range_start(Some(&range));
    let filters = parse_filters(None);

    // Return cached if fresh.
    let cached: Option<(Value, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT insight_text, created_at FROM ai_insights WHERE site_id=$1 AND range=$2 AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&q.site_id)
    .bind(&range)
    .fetch_optional(&state.db)
    .await?;
    if let Some((text, _)) = cached {
        if let Ok(arr) = serde_json::from_value::<Vec<Value>>(text.clone()) {
            return Ok(ok(json!({ "insights": arr, "cached": true })));
        }
    }

    // Build aggregated data snapshot for the prompt.
    let by_source = analytics::revenue_by_source(&state.db, &q.site_id, start, &filters).await?;
    let by_country = analytics::revenue_by_country(&state.db, &q.site_id, start, &filters).await?;
    let stats = analytics::overview(&state.db, &q.site_id, start, &filters).await?;
    let data = json!({
        "revenueBySource": by_source,
        "revenueByCountry": by_country,
        "totalRevenue": stats["revenue"],
        "totalEvents": stats["pageviews"],
    });

    let llm = Llm::from_state(&state);
    let prompt = format!(
        "You are a web analytics expert. Analyze this data for the \"{range}\" period and generate 3-5 actionable insights.\nDATA:\n{}\nReturn ONLY a JSON array of insight objects with fields: type (revenue_drivers|geo_opportunities|funnel_optimization|traffic_roi), title, summary, detail, confidence (0-1), action.",
        data
    );
    let insights = llm.json_array(&prompt).await.unwrap_or_else(|| heuristic_insights(&data));
    let arr = serde_json::to_value(&insights).unwrap_or(Value::Array(vec![]));

    // cache
    let now = Utc::now();
    let expires = now + chrono::Duration::hours(ttl_hours(&range));
    let _ = sqlx::query(
        "INSERT INTO ai_insights (id, site_id, range, insight_type, insight_text, data_refs, confidence, created_at, expires_at) VALUES ($1,$2,$3,'dashboard',$4,$5,0.5,$6,$7)",
    )
    .bind(new_id())
    .bind(&q.site_id)
    .bind(&range)
    .bind(&arr)
    .bind(&data)
    .bind(now)
    .bind(expires)
    .execute(&state.db)
    .await;

    Ok(ok(json!({ "insights": insights, "cached": false })))
}

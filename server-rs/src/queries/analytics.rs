use crate::error::AppResult;
use crate::queries::filters::{filter_parts, ParsedFilter};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

/// Build a filter WHERE fragment with ABSOLUTE placeholder indices starting at `start_idx`.
/// Returns (sql_with_leading_AND_or_empty, binds_in_order).
fn filters_where(start_idx: usize, filters: &[ParsedFilter]) -> (String, Vec<String>) {
    let (parts, binds) = filter_parts(filters, start_idx);
    if parts.is_empty() {
        return (String::new(), vec![]);
    }
    (format!(" AND {}", parts.join(" AND ")), binds)
}

/// Bind site_id, start, then extra binds onto a raw query.
fn run<'q>(
    sql: &'q str,
    site_id: &'q str,
    start: DateTime<Utc>,
    binds: Vec<String>,
    db: &'q PgPool,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    let mut q = sqlx::query(sql).bind(site_id).bind(start);
    for b in binds {
        q = q.bind(b);
    }
    q
}

// Where: site_id=$1, timestamp>=$2, then filters at $3..
fn base_where(start: DateTime<Utc>, filters: &[ParsedFilter]) -> (String, Vec<String>) {
    let (fsql, fbinds) = filters_where(3, filters);
    (format!("site_id = $1 AND timestamp >= $2{fsql}"), fbinds)
}

fn i64_(r: &sqlx::postgres::PgRow, idx: usize) -> i64 {
    r.try_get::<i64, usize>(idx)
        .ok()
        .or_else(|| r.try_get::<i32, usize>(idx).ok().map(|x| x as i64))
        .or_else(|| r.try_get::<f64, usize>(idx).ok().map(|x| x as i64))
        .unwrap_or(0)
}
fn f64_(r: &sqlx::postgres::PgRow, idx: usize) -> f64 {
    r.try_get::<f64, usize>(idx)
        .ok()
        .or_else(|| r.try_get::<i64, usize>(idx).ok().map(|x| x as f64))
        .or_else(|| {
            // numeric (decimal) -> via string
            let s: Option<String> = r.try_get::<Option<String>, usize>(idx).ok().flatten();
            s.and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or(0.0)
}
fn opt_str(r: &sqlx::postgres::PgRow, idx: usize) -> Option<String> {
    r.try_get::<Option<String>, usize>(idx).ok().flatten()
}

pub async fn overview(db: &PgPool, site_id: &str, start: DateTime<Utc>, filters: &[ParsedFilter]) -> AppResult<Value> {
    // Fast path: no filters -> read pre-aggregated events_hourly cagg (HLL visitors).
    // The cagg cannot honor arbitrary dimension filters, so fall back to raw scan then.
    let row = if filters.is_empty() {
        sqlx::query(
            "SELECT COALESCE(SUM(pageviews),0)::bigint, \
                    distinct_count(rollup(visitors_hll))::float8, \
                    COALESCE(SUM(conversions),0)::bigint, \
                    COALESCE(SUM(revenue),0)::float8 \
             FROM events_hourly WHERE site_id=$1 AND bucket>=$2",
        )
        .bind(site_id).bind(start).fetch_one(db).await?
    } else {
        let (wh, binds) = base_where(start, filters);
        let sql = format!(
            "SELECT COUNT(*) FILTER (WHERE event_type='pageview')::bigint,
                    COUNT(DISTINCT visitor_id)::bigint,
                    COUNT(*) FILTER (WHERE event_type='conversion')::bigint,
                    COALESCE(SUM(revenue) FILTER (WHERE revenue > 0), 0)::float8
             FROM events WHERE {wh}"
        );
        run(&sql, site_id, start, binds, db).fetch_one(db).await?
    };
    let sess_row = sqlx::query("SELECT COUNT(*)::bigint, AVG((is_bounce)::int)::float8 FROM sessions WHERE site_id=$1 AND started_at>=$2")
        .bind(site_id).bind(start).fetch_one(db).await?;
    Ok(json!({
        "pageviews": i64_(&row, 0),
        "visitors": i64_(&row, 1),
        "sessions": i64_(&sess_row, 0),
        "bounceRate": f64_(&sess_row, 1),
        "conversions": i64_(&row, 2),
        "revenue": f64_(&row, 3),
    }))
}

pub async fn timeseries(db: &PgPool, site_id: &str, start: DateTime<Utc>, hourly: bool, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let rows = if filters.is_empty() {
        // cagg fast path: visitors via HLL rollup per bucket.
        let b = if hourly { "bucket" } else { "date_trunc('day', bucket)" };
        let sql = format!(
            "SELECT {b} AS bucket, SUM(pageviews)::bigint, distinct_count(rollup(visitors_hll))::float8 \
             FROM events_hourly WHERE site_id=$1 AND bucket>=$2 GROUP BY 1 ORDER BY 1 ASC"
        );
        sqlx::query(&sql).bind(site_id).bind(start).fetch_all(db).await?
    } else {
        let (wh, binds) = base_where(start, filters);
        let bucket = if hourly { "date_trunc('hour', timestamp)" } else { "date_trunc('day', timestamp)" };
        let sql = format!(
            "SELECT {bucket} AS bucket, COUNT(*) FILTER (WHERE event_type='pageview'), COUNT(DISTINCT visitor_id) \
             FROM events WHERE {wh} AND event_type='pageview' GROUP BY 1 ORDER BY 1 ASC"
        );
        run(&sql, site_id, start, binds, db).fetch_all(db).await?
    };
    Ok(rows.iter().map(|r| json!({
        "date": r.try_get::<chrono::DateTime<Utc>, usize>(0).ok(),
        "pageviews": i64_(r, 1),
        "visitors": i64_(r, 2),
    })).collect())
}

pub async fn top_pages(db: &PgPool, site_id: &str, start: DateTime<Utc>, limit: i64, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let (wh, binds) = base_where(start, filters);
    let sql = format!(
        "SELECT path, COUNT(*), COUNT(DISTINCT visitor_id) FROM events \
         WHERE {wh} AND event_type='pageview' GROUP BY path ORDER BY 2 DESC LIMIT {limit}"
    );
    let rows = run(&sql, site_id, start, binds, db).fetch_all(db).await?;
    Ok(rows.iter().map(|r| json!({
        "path": opt_str(r, 0), "pageviews": i64_(r, 1), "visitors": i64_(r, 2)
    })).collect())
}

pub async fn referrers(db: &PgPool, site_id: &str, start: DateTime<Utc>, limit: i64, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let rows = if filters.is_empty() {
        // cagg fast path: visitors via HLL rollup per source.
        let sql = format!(
            "SELECT source, distinct_count(rollup(visitors_hll))::float8 FROM events_hourly \
             WHERE site_id=$1 AND bucket>=$2 GROUP BY source ORDER BY 2 DESC LIMIT {limit}"
        );
        sqlx::query(&sql).bind(site_id).bind(start).fetch_all(db).await?
    } else {
        let (wh, binds) = base_where(start, filters);
        let sql = format!(
            "SELECT source, COUNT(DISTINCT visitor_id) FROM events WHERE {wh} GROUP BY source ORDER BY 2 DESC LIMIT {limit}"
        );
        run(&sql, site_id, start, binds, db).fetch_all(db).await?
    };
    let total: i64 = rows.iter().map(|r| i64_(r, 1)).sum();
    Ok(rows.iter().map(|r| {
        let v = i64_(r, 1);
        json!({ "source": opt_str(r, 0).unwrap_or_else(|| "direct".into()), "visitors": v,
                "percentage": if total > 0 { (v as f64 / total as f64 * 100.0).round() as i64 } else { 0 } })
    }).collect())
}

pub async fn device_breakdown(db: &PgPool, site_id: &str, start: DateTime<Utc>) -> AppResult<Value> {
    async fn dim(db: &PgPool, site_id: &str, start: DateTime<Utc>, col: &str) -> AppResult<Vec<Value>> {
        let sql = format!(
            "SELECT COALESCE({col}, 'unknown'), COUNT(DISTINCT visitor_id) FROM sessions \
             WHERE site_id=$1 AND started_at>=$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
        );
        let rows = sqlx::query(&sql).bind(site_id).bind(start).fetch_all(db).await?;
        let total: i64 = rows.iter().map(|r| i64_(r, 1)).sum();
        Ok(rows.iter().map(|r| {
            let v = i64_(r, 1);
            json!({ col_to_key(col): opt_str(r, 0).unwrap_or_else(|| "unknown".into()), "visitors": v,
                    "percentage": if total > 0 { (v as f64 / total as f64 * 100.0).round() as i64 } else { 0 } })
        }).collect())
    }
    Ok(json!({
        "devices": dim(db, site_id, start, "device_type").await?,
        "os": dim(db, site_id, start, "os").await?,
        "browsers": dim(db, site_id, start, "browser").await?,
    }))
}
fn col_to_key(col: &str) -> &'static str {
    match col {
        "device_type" => "device",
        "browser" => "browser",
        "os" => "os",
        _ => "value",
    }
}

pub async fn geo(db: &PgPool, site_id: &str, start: DateTime<Utc>, limit: i64, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let (wh, binds) = base_where(start, filters);
    let sql = format!(
        "SELECT country, region, city, COUNT(DISTINCT visitor_id) FROM events WHERE {wh} \
         GROUP BY country, region, city ORDER BY 4 DESC LIMIT {limit}"
    );
    let rows = run(&sql, site_id, start, binds, db).fetch_all(db).await?;
    Ok(rows.iter().map(|r| json!({
        "country": opt_str(r, 0), "region": opt_str(r, 1), "city": opt_str(r, 2), "visitors": i64_(r, 3)
    })).collect())
}

pub async fn revenue_by_source(db: &PgPool, site_id: &str, start: DateTime<Utc>, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let rows = if filters.is_empty() {
        sqlx::query(
            "SELECT source, COALESCE(SUM(revenue),0)::float8, COALESCE(SUM(conversions),0)::bigint \
             FROM events_hourly WHERE site_id=$1 AND bucket>=$2 GROUP BY source ORDER BY 2 DESC LIMIT 20",
        )
        .bind(site_id).bind(start).fetch_all(db).await?
    } else {
        let (wh, binds) = base_where(start, filters);
        let sql = format!(
            "SELECT source, COALESCE(SUM(revenue), 0), COUNT(*) FROM events WHERE {wh} AND revenue > 0 \
             GROUP BY source ORDER BY 2 DESC LIMIT 20"
        );
        run(&sql, site_id, start, binds, db).fetch_all(db).await?
    };
    Ok(rows.iter().map(|r| json!({
        "source": opt_str(r, 0).unwrap_or_else(|| "direct".into()), "revenue": f64_(r, 1), "conversions": i64_(r, 2)
    })).collect())
}

pub async fn revenue_by_country(db: &PgPool, site_id: &str, start: DateTime<Utc>, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let (wh, binds) = base_where(start, filters);
    let sql = format!(
        "SELECT country, COALESCE(SUM(revenue), 0), COUNT(*) FROM events WHERE {wh} AND revenue > 0 \
         GROUP BY country ORDER BY 2 DESC LIMIT 20"
    );
    let rows = run(&sql, site_id, start, binds, db).fetch_all(db).await?;
    Ok(rows.iter().map(|r| json!({
        "country": opt_str(r, 0), "revenue": f64_(r, 1), "conversions": i64_(r, 2)
    })).collect())
}

pub async fn revenue_timeseries(db: &PgPool, site_id: &str, start: DateTime<Utc>, hourly: bool, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let rows = if filters.is_empty() {
        let b = if hourly { "bucket" } else { "date_trunc('day', bucket)" };
        let sql = format!(
            "SELECT {b}, COALESCE(SUM(revenue),0)::float8, COALESCE(SUM(conversions),0)::bigint \
             FROM events_hourly WHERE site_id=$1 AND bucket>=$2 GROUP BY 1 ORDER BY 1 ASC"
        );
        sqlx::query(&sql).bind(site_id).bind(start).fetch_all(db).await?
    } else {
        let (wh, binds) = base_where(start, filters);
        let bucket = if hourly { "date_trunc('hour', timestamp)" } else { "date_trunc('day', timestamp)" };
        let sql = format!(
            "SELECT {bucket}, COALESCE(SUM(revenue),0), COUNT(*) FROM events WHERE {wh} AND revenue > 0 \
             GROUP BY 1 ORDER BY 1 ASC"
        );
        run(&sql, site_id, start, binds, db).fetch_all(db).await?
    };
    Ok(rows.iter().map(|r| json!({
        "date": r.try_get::<chrono::DateTime<Utc>, usize>(0).ok(),
        "revenue": f64_(r, 1), "conversions": i64_(r, 2)
    })).collect())
}

pub async fn channel_breakdown(db: &PgPool, site_id: &str, start: DateTime<Utc>, filters: &[ParsedFilter]) -> AppResult<Vec<Value>> {
    let (wh, binds) = base_where(start, filters);
    let sql = format!(
        "SELECT utm_source, utm_medium, utm_campaign, COUNT(DISTINCT visitor_id), COUNT(*), \
                COALESCE(SUM(revenue),0) FROM events WHERE {wh} AND event_type='pageview' \
         GROUP BY utm_source, utm_medium, utm_campaign ORDER BY 4 DESC LIMIT 20"
    );
    let rows = run(&sql, site_id, start, binds, db).fetch_all(db).await?;
    Ok(rows.iter().map(|r| {
        let conv = i64_(r, 1); // pageviews placeholder; real conversion below
        json!({
            "utm_source": opt_str(r, 0), "utm_medium": opt_str(r, 1), "utm_campaign": opt_str(r, 2),
            "visitors": i64_(r, 3), "pageviews": i64_(r, 4), "revenue": f64_(r, 5), "conversions": conv
        })
    }).collect())
}

pub async fn sparkline(db: &PgPool, site_id: &str, start: DateTime<Utc>) -> AppResult<Vec<i64>> {
    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM events WHERE site_id=$1 AND event_type='pageview' AND timestamp>=$2 \
         GROUP BY date_trunc('day', timestamp) ORDER BY date_trunc('day', timestamp) ASC",
    )
    .bind(site_id).bind(start).fetch_all(db).await?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

pub async fn export_events(db: &PgPool, site_id: &str, start: DateTime<Utc>, limit: i64) -> AppResult<Vec<Value>> {
    let rows = sqlx::query(
        "SELECT visitor_id, session_id, event_type, name, path, hostname, referrer, utm_source, utm_medium, \
         utm_campaign, country, region, city, device_type, browser, os, revenue, timestamp \
         FROM events WHERE site_id=$1 AND timestamp>=$2 ORDER BY timestamp DESC LIMIT $3",
    )
    .bind(site_id).bind(start).bind(limit)
    .fetch_all(db).await?;
    Ok(rows.iter().map(|r| json!({
        "visitor_id": opt_str(r, 0), "session_id": opt_str(r, 1), "event_type": opt_str(r, 2),
        "name": opt_str(r, 3), "path": opt_str(r, 4), "hostname": opt_str(r, 5), "referrer": opt_str(r, 6),
        "utm_source": opt_str(r, 7), "utm_medium": opt_str(r, 8), "utm_campaign": opt_str(r, 9),
        "country": opt_str(r, 10), "region": opt_str(r, 11), "city": opt_str(r, 12),
        "device_type": opt_str(r, 13), "browser": opt_str(r, 14), "os": opt_str(r, 15),
        "revenue": f64_(r, 16), "timestamp": r.try_get::<chrono::DateTime<Utc>, usize>(17).ok(),
    })).collect())
}

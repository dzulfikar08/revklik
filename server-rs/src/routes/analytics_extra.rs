use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::queries::filters::range_start;
use crate::services::plans::require_plan;
use crate::state::AppState;
use crate::web::{ok, ok_value};
use axum::extract::{Path, Query, State};
use axum::response::Response;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

macro_rules! gate {
    ($s:expr, $auth:expr, $site_id:expr) => {
        crate::middleware::site_access::require(&$s.db, &$auth, $site_id).await
    };
}

#[derive(Deserialize)]
pub struct SitePathQuery {
    pub site_id: String,
    pub path: Option<String>,
    pub range: Option<String>,
    pub filters: Option<String>,
}

// ---------- funnel ----------
pub async fn funnel(auth: Auth, State(s): State<AppState>, Query(q): Query<SitePathQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let start = range_start(q.range.as_deref());

    let total: (i64,) = sqlx::query_as("SELECT COUNT(DISTINCT visitor_id)::bigint FROM events WHERE site_id=$1 AND timestamp>=$2")
        .bind(&q.site_id).bind(start).fetch_one(&s.db).await?;
    let total = total.0;

    let scroll_rows: Vec<(Option<String>, Option<String>, Option<Value>, Option<String>)> = sqlx::query_as(
        "SELECT visitor_id, name, props, path FROM events WHERE site_id=$1 AND name IN ('scroll','scroll_section') AND timestamp>=$2")
        .bind(&q.site_id).bind(start).fetch_all(&s.db).await?;

    let (page_section, section_visitors, depths) = process_scroll(&scroll_rows);
    let steps = if !section_visitors.is_empty() {
        build_funnel_steps(&section_visitors, total)
    } else {
        build_depth_steps(&depths, total)
    };
    let conv_rate = if steps.len() >= 2 && total > 0 {
        ((steps.last().unwrap().visitors as f64 / total as f64) * 1000.0).round() / 10.0
    } else { 0.0 };

    // per-page pageview visitor counts
    let page_vis: Vec<(String, i64)> = sqlx::query_as(
        "SELECT path, COUNT(DISTINCT visitor_id)::bigint FROM events WHERE site_id=$1 AND event_type='pageview' AND timestamp>=$2 GROUP BY path ORDER BY 2 DESC LIMIT 50")
        .bind(&q.site_id).bind(start).fetch_all(&s.db).await?;
    let page_vis_map: HashMap<String, i64> = page_vis.into_iter().collect();

    let mut pages: Vec<Value> = page_section
        .iter()
        .map(|(path, sec_map)| {
            let ptot = *page_vis_map.get(path).unwrap_or(&0);
            let pst = build_funnel_steps(sec_map, ptot);
            let pcr = if pst.len() >= 2 && ptot > 0 {
                ((pst.last().unwrap().visitors as f64 / ptot as f64) * 1000.0).round() / 10.0
            } else { 0.0 };
            json!({ "path": path, "steps": pst, "totalVisitors": ptot, "conversionRate": pcr })
        })
        .filter(|p| p.get("steps").and_then(|s| s.as_array()).map(|a| !a.is_empty()).unwrap_or(false))
        .collect();
    pages.sort_by_key(|p| -(p.get("totalVisitors").and_then(|v| v.as_i64()).unwrap_or(0)));

    Ok(ok(json!({ "steps": steps, "totalVisitors": total, "conversionRate": conv_rate, "pages": pages })))
}

#[derive(Clone, serde::Serialize)]
struct FunnelStep { section: String, visitors: i64, percentage: i64, dropoff: i64 }

fn build_funnel_steps(map: &HashMap<String, std::collections::HashSet<String>>, total: i64) -> Vec<FunnelStep> {
    let mut entries: Vec<(&String, usize)> = map.iter().map(|(k, v)| (k, v.len())).collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries
        .iter()
        .enumerate()
        .map(|(i, (section, sz))| {
            let prev = if i == 0 { total as usize } else { entries[i - 1].1 };
            FunnelStep {
                section: (*section).clone(),
                visitors: *sz as i64,
                percentage: if total > 0 { ((*sz as f64 / total as f64) * 100.0).round() as i64 } else { 0 },
                dropoff: if i > 0 && prev > 0 { (((prev - sz) as f64 / prev as f64) * 100.0).round() as i64 } else { 0 },
            }
        })
        .collect()
}

fn build_depth_steps(depths: &HashMap<String, f64>, total: i64) -> Vec<FunnelStep> {
    let buckets = [25, 50, 75, 90];
    let mut counts: HashMap<i64, i64> = HashMap::new();
    for (_, d) in depths {
        for b in buckets {
            if *d >= b as f64 { *counts.entry(b).or_insert(0) += 1; }
        }
    }
    let present: Vec<i64> = buckets.iter().copied().filter(|b| counts.get(b).copied().unwrap_or(0) > 0).collect();
    present
        .iter()
        .enumerate()
        .map(|(i, b)| {
            let v = counts.get(b).copied().unwrap_or(0);
            let prev = if i == 0 { total } else { counts.get(&present[i - 1]).copied().unwrap_or(total) };
            FunnelStep {
                section: format!("{b}%"),
                visitors: v,
                percentage: if total > 0 { ((v as f64 / total as f64) * 100.0).round() as i64 } else { 0 },
                dropoff: if i > 0 && prev > 0 { (((prev - v) as f64 / prev as f64) * 100.0).round() as i64 } else { 0 },
            }
        })
        .collect()
}

fn process_scroll(rows: &[(Option<String>, Option<String>, Option<Value>, Option<String>)]) -> (HashMap<String, HashMap<String, std::collections::HashSet<String>>>, HashMap<String, std::collections::HashSet<String>>, HashMap<String, f64>) {
    let mut page_section: HashMap<String, HashMap<String, std::collections::HashSet<String>>> = HashMap::new();
    let mut section_visitors: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
    let mut depths: HashMap<String, f64> = HashMap::new();
    for (visitor_id, _name, props, path) in rows {
        let (Some(vid), Some(path)) = (visitor_id.as_ref(), path.as_ref()) else { continue };
        if let Some(p) = props {
            if let Some(section) = p.get("section").and_then(|v| v.as_str()) {
                page_section.entry(path.clone()).or_default().entry(section.to_string()).or_default().insert(vid.clone());
                section_visitors.entry(section.to_string()).or_default().insert(vid.clone());
            }
            if let Some(d) = p.get("depth").and_then(|v| v.as_f64()) {
                let cur = depths.get(vid).copied().unwrap_or(0.0);
                if d > cur { depths.insert(vid.clone(), d); }
            }
        }
    }
    (page_section, section_visitors, depths)
}

// ---------- visitors ----------
pub async fn visitors(auth: Auth, State(s): State<AppState>, Query(q): Query<SitePathQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    use crate::queries::{row_dt, row_f64, row_i64, row_json, row_str};
    let rows = sqlx::query(
        "SELECT visitor_id, name, email, phone, first_seen, last_seen, country, region, city, device_type, browser, os, total_sessions, total_pageviews, total_revenue, tags, notes FROM visitor_profiles WHERE site_id=$1 ORDER BY last_seen DESC LIMIT 100")
        .bind(&q.site_id).fetch_all(&s.db).await?;
    Ok(ok_value(Value::Array(rows.iter().map(|r| json!({
        "visitor_id":row_str(r,0),"name":row_str(r,1),"email":row_str(r,2),"phone":row_str(r,3),
        "first_seen":row_dt(r,4),"last_seen":row_dt(r,5),"country":row_str(r,6),"region":row_str(r,7),"city":row_str(r,8),
        "device_type":row_str(r,9),"browser":row_str(r,10),"os":row_str(r,11),
        "total_sessions":row_i64(r,12),"total_pageviews":row_i64(r,13),"total_revenue":row_f64(r,14),
        "tags":row_json(r,15),"notes":row_str(r,16)
    })).collect())))
}

pub async fn update_visitor(auth: Auth, State(s): State<AppState>, Path(vid): Path<String>, body: axum::Json<Value>) -> AppResult<Response> {
    let row: Option<(String,)> = sqlx::query_as("SELECT site_id FROM visitor_profiles WHERE visitor_id=$1").bind(&vid).fetch_optional(&s.db).await?;
    let Some((site_id,)) = row else { return Err(AppError::NotFound) };
    gate!(s, auth, &site_id)?;
    let mut parts = Vec::new();
    let mut binds: Vec<String> = vec![];
    let mut bind_i = 2;
    for (k, conv) in [("name", "text"), ("email", "text"), ("phone", "text"), ("notes", "text")] {
        if let Some(v) = body.get(k).and_then(|v| v.as_str()) {
            parts.push(format!("{k}=${bind_i}"));
            binds.push(v.to_string());
            bind_i += 1;
        }
    }
    if let Some(tags) = body.get("tags") {
        parts.push(format!("tags=${bind_i}"));
        binds.push(tags.to_string());
        bind_i += 1;
    }
    if !parts.is_empty() {
        let sql = format!("UPDATE visitor_profiles SET {} WHERE visitor_id=$1", parts.join(","));
        let mut q = sqlx::query(&sql).bind(&vid);
        for b in binds { q = q.bind(b); }
        q.execute(&s.db).await?;
    }
    Ok(ok(json!({"success":true})))
}

// ---------- heatmap (Growth) ----------
pub async fn heatmap(auth: Auth, State(s): State<AppState>, Query(q): Query<SitePathQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let (allowed, plan) = require_plan(&s.db, &auth.user_id, 2).await;
    if !allowed {
        return Err(AppError::Forbidden(format!("Heatmaps require the Growth plan (current: {plan})")));
    }
    let start = range_start(q.range.as_deref());
    let path = q.path.as_deref().unwrap_or("/");

    let clicks: Vec<(f64, f64, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT x, y, element_selector, element_text, visitor_id FROM heatmap_clicks WHERE site_id=$1 AND path=$2 AND timestamp>=$3 LIMIT 5000")
        .bind(&q.site_id).bind(path).bind(start).fetch_all(&s.db).await?;
    let scrolls: Vec<(f64, String)> = sqlx::query_as(
        "SELECT max_scroll, visitor_id FROM heatmap_scrolls WHERE site_id=$1 AND path=$2 AND timestamp>=$3 LIMIT 5000")
        .bind(&q.site_id).bind(path).bind(start).fetch_all(&s.db).await?;
    let sess: (i64,) = sqlx::query_as("SELECT COUNT(DISTINCT visitor_id)::bigint FROM heatmap_clicks WHERE site_id=$1 AND path=$2 AND timestamp>=$3")
        .bind(&q.site_id).bind(path).bind(start).fetch_one(&s.db).await?;

    // 50x50 grid
    let mut grid = vec![vec![0i64; 50]; 50];
    let mut elem: HashMap<String, (String, i64, String)> = HashMap::new();
    for (x, y, sel, text, _vid) in &clicks {
        let bx = ((*x as i64) / 2).clamp(0, 49) as usize;
        let by = ((*y as i64) / 2).clamp(0, 49) as usize;
        grid[by][bx] += 1;
        if let Some(selector) = sel {
            let e = elem.entry(selector.clone()).or_insert_with(|| (selector.clone(), 0, text.clone().unwrap_or(selector.clone())));
            e.1 += 1;
        }
    }
    let mut top_elements: Vec<Value> = elem.into_values().map(|(selector, clicks, label)| json!({"selector":selector,"clicks":clicks,"label":label}))
        .collect();
    top_elements.sort_by_key(|v| -(v.get("clicks").and_then(|c| c.as_i64()).unwrap_or(0)));
    top_elements.truncate(20);

    let mut depth_counts: HashMap<i64, i64> = (0..=10).map(|d| (d * 10, 0)).collect();
    for (ms, _vid) in &scrolls {
        let b = (((*ms).round() as i64) / 10 * 10).clamp(0, 100);
        *depth_counts.entry(b).or_insert(0) += 1;
    }
    let scroll_depths: Vec<Value> = (0..=10).map(|d| { let dd = d*10; json!({"depth":dd,"visitors":depth_counts.get(&dd).copied().unwrap_or(0)}) }).collect();

    Ok(ok(json!({
        "clickGrid": grid,
        "scrollDepths": scroll_depths,
        "totalSessions": sess.0,
        "totalClicks": clicks.len(),
        "topElements": top_elements,
    })))
}

// ---------- recordings (Growth) ----------
pub async fn recordings(auth: Auth, State(s): State<AppState>, Query(q): Query<SitePathQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    let (allowed, plan) = require_plan(&s.db, &auth.user_id, 2).await;
    if !allowed { return Err(AppError::Forbidden(format!("Session recordings require the Growth plan (current: {plan})"))); }
    let start = range_start(q.range.as_deref());
    let rows: Vec<(String,String,String,i32,Option<i32>,chrono::DateTime<Utc>,Value)> = sqlx::query_as(
        "SELECT id, session_id, path, duration, viewport_width, started_at, events FROM session_recordings WHERE site_id=$1 AND started_at>=$2 ORDER BY started_at DESC LIMIT 50")
        .bind(&q.site_id).bind(start).fetch_all(&s.db).await?;
    let data: Vec<Value> = rows.into_iter().map(|(id,sid,path,dur,vw,started,events)| {
        let count = events.as_array().map(|a| a.len() as i64).unwrap_or(0);
        json!({"id":id,"session_id":sid,"path":path,"duration":dur,"viewport_width":vw,"started_at":started,"event_count":count,"has_revenue":false})
    }).collect();
    Ok(ok_value(Value::Array(data)))
}

pub async fn recording_detail(auth: Auth, State(s): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    let (allowed, plan) = require_plan(&s.db, &auth.user_id, 2).await;
    if !allowed { return Err(AppError::Forbidden(format!("Session recordings require the Growth plan (current: {plan})"))); }
    let row: Option<(String,String,String,i32,Option<i32>,Option<i32>,chrono::DateTime<Utc>,Value,String)> = sqlx::query_as(
        "SELECT id, session_id, path, duration, viewport_width, viewport_height, started_at, events, site_id FROM session_recordings WHERE id=$1")
        .bind(&id).fetch_optional(&s.db).await?;
    let Some((rid,sid,path,dur,vw,vh,started,events,site_id)) = row else { return Err(AppError::NotFound) };
    gate!(s, auth, &site_id)?;
    let type_map = [("m","mutation"),("c","interaction"),("s","scroll"),("r","resize")];
    let mapped: Vec<Value> = events.as_array().map(|a| {
        a.iter().filter_map(|e| {
            let t = e.get("t").cloned().unwrap_or(Value::Null);
            let ty = e.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let full = type_map.iter().find(|(k,_)| *k==ty).map(|(_,v)| *v).unwrap_or("interaction");
            Some(json!({"t":t,"type":full,"d":e.get("d").cloned().unwrap_or(Value::Null)}))
        }).collect()
    }).unwrap_or_default();
    Ok(ok(json!({
        "id":rid,"session_id":sid,"path":path,"duration":dur,"viewport_width":vw,"viewport_height":vh,"started_at":started,
        "event_count":mapped.len(),"has_revenue":false,"events":mapped
    })))
}

// ---------- export variants (visitors / sessions) ----------
pub async fn export_visitors(auth: Auth, State(s): State<AppState>, Query(q): Query<crate::routes::analytics::SiteRangeQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    use crate::queries::{row_dt, row_f64, row_i64, row_str};
    let rows = sqlx::query(
        "SELECT visitor_id, name, email, country, region, city, device_type, browser, os, total_sessions, total_pageviews, total_revenue, first_seen, last_seen FROM visitor_profiles WHERE site_id=$1 ORDER BY last_seen DESC LIMIT 10000")
        .bind(&q.site_id).fetch_all(&s.db).await?;
    let data: Vec<Value> = rows.iter().map(|r| json!({"visitor_id":row_str(r,0),"name":row_str(r,1),"email":row_str(r,2),"country":row_str(r,3),"region":row_str(r,4),"city":row_str(r,5),"device_type":row_str(r,6),"browser":row_str(r,7),"os":row_str(r,8),"total_sessions":row_i64(r,9),"total_pageviews":row_i64(r,10),"total_revenue":row_f64(r,11),"first_seen":row_dt(r,12),"last_seen":row_dt(r,13)})).collect();
    if q.format.as_deref() == Some("csv") {
        let cols = ["visitor_id","name","email","country","region","city","device_type","browser","os","total_sessions","total_pageviews","total_revenue","first_seen","last_seen"];
        let csv = crate::queries::filters::to_csv(&data, &cols);
        Ok(csv_response(csv, "visitors"))
    } else {
        Ok(ok_value(Value::Array(data)))
    }
}

pub async fn export_sessions(auth: Auth, State(s): State<AppState>, Query(q): Query<crate::routes::analytics::SiteRangeQuery>) -> AppResult<Response> {
    gate!(s, auth, &q.site_id)?;
    use crate::queries::{row_bool, row_dt, row_i64, row_opt_dt, row_str};
    let start = range_start(q.range.as_deref());
    let rows = sqlx::query(
        "SELECT id, visitor_id, entry_path, exit_path, referrer, utm_source, utm_medium, utm_campaign, country, city, device_type, browser, page_count, is_bounce, started_at, ended_at FROM sessions WHERE site_id=$1 AND started_at>=$2 ORDER BY started_at DESC LIMIT 10000")
        .bind(&q.site_id).bind(start).fetch_all(&s.db).await?;
    let data: Vec<Value> = rows.iter().map(|r| json!({"id":row_str(r,0),"visitor_id":row_str(r,1),"entry_path":row_str(r,2),"exit_path":row_str(r,3),"referrer":row_str(r,4),"utm_source":row_str(r,5),"utm_medium":row_str(r,6),"utm_campaign":row_str(r,7),"country":row_str(r,8),"city":row_str(r,9),"device_type":row_str(r,10),"browser":row_str(r,11),"page_count":row_i64(r,12),"is_bounce":row_bool(r,13),"started_at":row_dt(r,14),"ended_at":row_opt_dt(r,15)})).collect();
    if q.format.as_deref() == Some("csv") {
        let cols = ["id","visitor_id","entry_path","exit_path","referrer","utm_source","utm_medium","utm_campaign","country","city","device_type","browser","page_count","is_bounce","started_at","ended_at"];
        let csv = crate::queries::filters::to_csv(&data, &cols);
        Ok(csv_response(csv, "sessions"))
    } else {
        Ok(ok_value(Value::Array(data)))
    }
}

fn csv_response(csv: String, kind: &str) -> Response {
    let mut resp = axum::response::Response::new(axum::body::Body::from(csv));
    let h = resp.headers_mut();
    h.insert(axum::http::header::CONTENT_TYPE, axum::http::HeaderValue::from_static("text/csv"));
    h.insert(axum::http::header::CONTENT_DISPOSITION, axum::http::HeaderValue::from_str(&format!("attachment; filename=\"{kind}.csv\"")).unwrap());
    resp
}

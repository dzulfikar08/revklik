use crate::error::{AppError, AppResult};
use crate::services::quota::{enforce_site_quota, SiteMeta};
use crate::state::AppState;
use crate::web::{client_ip, country_from_timezone, new_id};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::time::Duration;

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}
fn f64_of(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}
fn ts_of(v: &Value) -> DateTime<Utc> {
    // Unix milliseconds.
    v.get("ts").and_then(|x| x.as_i64()).and_then(|ms| Utc.timestamp_millis_opt(ms).single()).unwrap_or_else(Utc::now)
}

fn event_type_of(t: &str) -> &'static str {
    match t {
        "p" => "pageview",
        "c" => "conversion",
        _ => "custom",
    }
}

struct Ctx {
    ip: Option<IpAddr>,
    geo: crate::services::geoip::Geo,
    ua: String,
    lang: String,
    fingerprint: String,
}

async fn build_ctx(state: &AppState, headers: &HeaderMap, screen_res: Option<&str>) -> Ctx {
    let ip = client_ip(headers, state.config.trusted_proxy_hops);
    let geo = state.geoip.lookup(ip);
    let ua = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let lang = headers
        .get(axum::http::header::ACCEPT_LANGUAGE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ip_str = ip.map(|i| i.to_string()).unwrap_or_else(|| "unknown".into());
    let fingerprint = crate::services::fingerprint::fingerprint(&ip_str, &ua, &lang, screen_res);
    Ctx { ip, geo, ua, lang, fingerprint }
}

fn geo_with_tz(geo: &crate::services::geoip::Geo, tz: Option<&str>) -> (Option<String>, Option<String>, Option<String>) {
    if geo.country.is_some() {
        (geo.country.clone(), geo.region.clone(), geo.city.clone())
    } else if let Some(tz) = tz {
        let country = country_from_timezone(tz);
        (country, None, None)
    } else {
        (None, None, None)
    }
}

/// Insert one event + upsert session + upsert visitor_profile.
#[allow(clippy::too_many_arguments)]
async fn write_event(
    db: &sqlx::PgPool,
    site_id: &str,
    ev: &Value,
    ctx: &Ctx,
) -> AppResult<Option<String>> {
    let sid = match s(ev, "sid") {
        Some(x) => x,
        None => return Ok(None),
    };
    let path = match s(ev, "p") {
        Some(x) => x,
        None => return Ok(None),
    };
    let t = s(ev, "t").unwrap_or_else(|| "p".into());
    let event_type = event_type_of(&t).to_string();
    let ts = ts_of(ev);

    // visitor resolution (cookieless): explicit vid, else fingerprint lookup, else new.
    let mut vid = s(ev, "vid");
    if vid.is_none() {
        let fp = s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone());
        let found: Option<(String,)> = sqlx::query_as(
            "SELECT visitor_id FROM visitor_profiles WHERE site_id = $1 AND fingerprint = $2",
        )
        .bind(site_id)
        .bind(&fp)
        .fetch_optional(db)
        .await?;
        vid = found.map(|(v,)| v).or_else(|| Some(format!("fp_{}", &crate::web::random_token(12))));
    }
    let vid = vid.unwrap();

    let (country, region, city) = geo_with_tz(&ctx.geo, s(ev, "tz").as_deref());

    // session upsert (two-step: composite PK forbids ON CONFLICT(id)).
    let existing_session: Option<()> = sqlx::query_as("SELECT 1 FROM sessions WHERE id = $1 AND site_id = $2")
        .bind(&sid)
        .bind(site_id)
        .fetch_optional(db)
        .await?;
    let is_new_session = existing_session.is_none();
    if is_new_session {
        sqlx::query(
            "INSERT INTO sessions (id, site_id, visitor_id, started_at, ended_at, entry_path, exit_path, \
             referrer, utm_source, utm_medium, utm_campaign, country, region, city, device_type, browser, os, \
             page_count, is_bounce, fingerprint) \
             VALUES ($1,$2,$3,$4,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,true,$16)",
        )
        .bind(&sid)
        .bind(site_id)
        .bind(&vid)
        .bind(ts)
        .bind(&path)
        .bind(s(ev, "r"))
        .bind(s(ev, "us"))
        .bind(s(ev, "um"))
        .bind(s(ev, "uc"))
        .bind(&country)
        .bind(&region)
        .bind(&city)
        .bind(s(ev, "dv"))
        .bind(s(ev, "br"))
        .bind(s(ev, "os"))
        .bind(s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone()))
        .execute(db)
        .await?;
    } else {
        sqlx::query(
            "UPDATE sessions SET exit_path=$1, ended_at=$2, page_count=page_count+1, is_bounce=false \
             WHERE id=$3 AND site_id=$4",
        )
        .bind(&path)
        .bind(ts)
        .bind(&sid)
        .bind(site_id)
        .execute(db)
        .await?;
    }

    // visitor profile upsert.
    let pv_inc: i64 = if event_type == "pageview" { 1 } else { 0 };
    let sess_inc: i64 = if is_new_session { 1 } else { 0 };
    let rev_inc = f64_of(ev, "rv").unwrap_or(0.0);
    sqlx::query(
        "INSERT INTO visitor_profiles (id, site_id, visitor_id, first_seen, last_seen, country, region, city, \
         device_type, browser, os, total_sessions, total_pageviews, total_revenue, fingerprint) \
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) \
         ON CONFLICT (site_id, visitor_id) DO UPDATE SET \
           last_seen=EXCLUDED.last_seen, \
           total_sessions=visitor_profiles.total_sessions + $15, \
           total_pageviews=visitor_profiles.total_pageviews + $12, \
           total_revenue=visitor_profiles.total_revenue + $13, \
           country=COALESCE(visitor_profiles.country, EXCLUDED.country), \
           city=COALESCE(visitor_profiles.city, EXCLUDED.city), \
           device_type=COALESCE(visitor_profiles.device_type, EXCLUDED.device_type), \
           fingerprint=COALESCE(visitor_profiles.fingerprint, EXCLUDED.fingerprint)",
    )
    .bind(new_id())
    .bind(site_id)
    .bind(&vid)
    .bind(ts)
    .bind(&country)
    .bind(&region)
    .bind(&city)
    .bind(s(ev, "dv"))
    .bind(s(ev, "br"))
    .bind(s(ev, "os"))
    .bind(sess_inc)
    .bind(pv_inc)
    .bind(rev_inc)
    .bind(s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone()))
    .bind(sess_inc)
    .execute(db)
    .await?;

    // event insert.
    let props = ev.get("pr").filter(|v| !v.is_null()).cloned();
    sqlx::query(
        "INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, hostname, \
         referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, country, region, city, \
         device_type, browser, os, revenue, props, fingerprint, payment_provider, payment_method, currency, subscription_id) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)",
    )
    .bind(new_id())
    .bind(site_id)
    .bind(&sid)
    .bind(&vid)
    .bind(ts)
    .bind(&event_type)
    .bind(s(ev, "n"))
    .bind(&path)
    .bind(s(ev, "h"))
    .bind(s(ev, "r"))
    .bind(s(ev, "us"))
    .bind(s(ev, "um"))
    .bind(s(ev, "uc"))
    .bind(s(ev, "ut"))
    .bind(s(ev, "uco"))
    .bind(&country)
    .bind(&region)
    .bind(&city)
    .bind(s(ev, "dv"))
    .bind(s(ev, "br"))
    .bind(s(ev, "os"))
    .bind(f64_of(ev, "rv"))
    .bind(props)
    .bind(s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone()))
    .bind(s(ev, "pp"))
    .bind(s(ev, "pm"))
    .bind(s(ev, "cur"))
    .bind(s(ev, "sub"))
    .execute(db)
    .await?;

    Ok(Some(vid))
}

/// Batch write: 5 queries total per request (regardless of N events) instead
/// of 5×N in the per-event path. Resolves visitor_ids, looks up existing
/// sessions, then bulk-upserts visitor_profiles + sessions and multi-row
/// inserts events. Returns the last resolved visitor_id.
async fn write_events_batch(db: &sqlx::PgPool, site_id: &str, events: &[&Value], ctx: &Ctx) -> AppResult<Option<String>> {
    if events.is_empty() {
        return Ok(None);
    }

    // 1. resolve vids for events lacking one (one fingerprint lookup).
    let mut need_fp: Vec<String> = Vec::new();
    for ev in events {
        if s(ev, "vid").is_none() {
            let fp = s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone());
            if !need_fp.contains(&fp) {
                need_fp.push(fp);
            }
        }
    }
    let fp_map: HashMap<String, String> = if need_fp.is_empty() {
        HashMap::new()
    } else {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT visitor_id, fingerprint FROM visitor_profiles WHERE site_id = $1 AND fingerprint = ANY($2)",
        )
        .bind(site_id)
        .bind(&need_fp)
        .fetch_all(db)
        .await?;
        rows.into_iter().collect()
    };

    let mut vids: Vec<String> = Vec::with_capacity(events.len());
    for ev in events {
        let vid = s(ev, "vid").or_else(|| {
            let fp = s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone());
            fp_map.get(&fp).cloned()
        }).unwrap_or_else(|| format!("fp_{}", crate::web::random_token(12)));
        vids.push(vid);
    }

    // 2. existing sessions in DB for this batch's sids (one lookup).
    let mut sids: Vec<String> = Vec::new();
    for ev in events {
        if let Some(sid) = s(ev, "sid") {
            if !sids.contains(&sid) {
                sids.push(sid);
            }
        }
    }
    let existing_sessions: HashSet<String> = if sids.is_empty() {
        HashSet::new()
    } else {
        let rows: Vec<(String,)> = sqlx::query_as("SELECT id FROM sessions WHERE site_id = $1 AND id = ANY($2)")
            .bind(site_id)
            .bind(&sids)
            .fetch_all(db)
            .await?;
        rows.into_iter().map(|(x,)| x).collect()
    };

    // 3. visitor_profiles: first-sight INSERT only (ON CONFLICT DO NOTHING).
    // Counters are NOT maintained per event (caused dead-tuple bloat + the 1M
    // ingest wall); the visitor_rollup job recomputes total_* from events hourly.
    // Aggregate per visitor so a batch with repeated visitors issues one row each.
    {
        struct VAgg {
            last_seen: DateTime<Utc>,
            country: Option<String>,
            region: Option<String>,
            city: Option<String>,
            dv: Option<String>,
            br: Option<String>,
            os: Option<String>,
            fp: String,
        }
        let mut vorder: Vec<String> = Vec::new();
        let mut vmap: HashMap<String, VAgg> = HashMap::new();
        for (i, ev) in events.iter().enumerate() {
            let vid = vids[i].clone();
            let ts = ts_of(ev);
            let (country, region, city) = geo_with_tz(&ctx.geo, s(ev, "tz").as_deref());
            let fp = s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone());
            match vmap.get_mut(&vid) {
                Some(a) => {
                    if ts > a.last_seen {
                        a.last_seen = ts;
                    }
                    if a.country.is_none() { a.country = country; }
                    if a.region.is_none() { a.region = region; }
                    if a.city.is_none() { a.city = city; }
                    if a.dv.is_none() { a.dv = s(ev, "dv"); }
                    if a.br.is_none() { a.br = s(ev, "br"); }
                    if a.os.is_none() { a.os = s(ev, "os"); }
                    if a.fp.is_empty() { a.fp = fp; }
                }
                None => {
                    vorder.push(vid.clone());
                    vmap.insert(vid, VAgg {
                        last_seen: ts,
                        country, region, city,
                        dv: s(ev, "dv"), br: s(ev, "br"), os: s(ev, "os"), fp,
                    });
                }
            }
        }

        let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new(
            "INSERT INTO visitor_profiles (id, site_id, visitor_id, first_seen, last_seen, country, region, city, \
             device_type, browser, os, fingerprint) VALUES ",
        );
        // Sort by visitor_id so every transaction acquires row locks in the same
        // order -> prevents cross-batch ON CONFLICT deadlocks.
        vorder.sort();
        for (n, vid) in vorder.iter().enumerate() {
            if n > 0 {
                qb.push(", ");
            }
            let a = vmap.get(vid).expect("agg present");
            // first_seen/last_seen/dims set on first sight only. Counters (total_*)
            // are NOT maintained per event (that caused dead-tuple bloat + the 1M
            // ingest wall); a periodic visitor_rollup job recomputes them from events.
            qb.push("(")
                .push_bind(new_id()).push(", ").push_bind(site_id).push(", ").push_bind(vid.clone()).push(", ")
                .push_bind(a.last_seen).push(", ").push_bind(a.last_seen).push(", ")
                .push_bind(a.country.clone()).push(", ").push_bind(a.region.clone()).push(", ").push_bind(a.city.clone()).push(", ")
                .push_bind(a.dv.clone()).push(", ").push_bind(a.br.clone()).push(", ").push_bind(a.os.clone()).push(", ")
                .push_bind(a.fp.clone())
                .push(")");
        }
        qb.push(" ON CONFLICT (site_id, visitor_id) DO NOTHING");
        qb.build().execute(db).await?;
    }

    // 4. sessions bulk upsert (one row per unique sid; accumulates page_count).
    {
        // first/last event index per sid (earliest/latest ts) + per-sid page count.
        let mut first: HashMap<String, usize> = HashMap::new();
        let mut last: HashMap<String, usize> = HashMap::new();
        let mut count: HashMap<String, i64> = HashMap::new();
        for (i, ev) in events.iter().enumerate() {
            let sid = s(ev, "sid").unwrap_or_default();
            let ts = ts_of(ev);
            match first.get(&sid) {
                Some(&j) if ts_of(events[j]) <= ts => {}
                _ => { first.insert(sid.clone(), i); }
            }
            match last.get(&sid) {
                Some(&j) if ts_of(events[j]) >= ts => {}
                _ => { last.insert(sid.clone(), i); }
            }
            *count.entry(sid).or_insert(0) += 1;
        }

        // Partition: new sessions -> multi-row INSERT; existing -> one bulk UPDATE
        // (Timescale forbids a unique index omiting started_at, so no ON CONFLICT).
        let mut ins = sqlx::QueryBuilder::<sqlx::Postgres>::new(
            "INSERT INTO sessions (id, site_id, visitor_id, started_at, ended_at, entry_path, exit_path, \
             referrer, utm_source, utm_medium, utm_campaign, country, region, city, device_type, browser, os, \
             page_count, is_bounce, fingerprint) VALUES ",
        );
        let mut any_new = false;
        let mut u_id: Vec<String> = Vec::new();
        let mut u_exit: Vec<String> = Vec::new();
        let mut u_end: Vec<DateTime<Utc>> = Vec::new();
        let mut u_inc: Vec<i32> = Vec::new();
        for sid in &sids {
            let Some(&fi) = first.get(sid) else { continue };
            let li = *last.get(sid).unwrap_or(&fi);
            let fev = events[fi];
            let lev = events[li];
            let vid = vids[fi].clone();
            let started = ts_of(fev);
            let ended = ts_of(lev);
            let pc = count.get(sid).copied().unwrap_or(1);
            let (country, region, city) = geo_with_tz(&ctx.geo, s(fev, "tz").as_deref());
            if !existing_sessions.contains(sid) {
                if any_new {
                    ins.push(", ");
                }
                any_new = true;
                ins.push("(")
                    .push_bind(sid.clone()).push(", ").push_bind(site_id).push(", ").push_bind(vid).push(", ")
                    .push_bind(started).push(", ").push_bind(ended).push(", ")
                    .push_bind(s(fev, "p").unwrap_or_default()).push(", ").push_bind(s(lev, "p").unwrap_or_default()).push(", ")
                    .push_bind(s(fev, "r")).push(", ").push_bind(s(fev, "us")).push(", ").push_bind(s(fev, "um")).push(", ").push_bind(s(fev, "uc")).push(", ")
                    .push_bind(country).push(", ").push_bind(region).push(", ").push_bind(city).push(", ")
                    .push_bind(s(fev, "dv")).push(", ").push_bind(s(fev, "br")).push(", ").push_bind(s(fev, "os")).push(", ")
                    .push_bind(pc).push(", ").push_bind(pc == 1).push(", ")
                    .push_bind(s(fev, "fp").unwrap_or_else(|| ctx.fingerprint.clone()))
                    .push(")");
            } else {
                u_id.push(sid.clone());
                u_exit.push(s(lev, "p").unwrap_or_default());
                u_end.push(ended);
                u_inc.push(pc as i32);
            }
        }
        if any_new {
            ins.build().execute(db).await?;
        }
        if !u_id.is_empty() {
            // sort by session id -> deterministic lock order, avoids deadlocks.
            let mut idx: Vec<usize> = (0..u_id.len()).collect();
            idx.sort_by(|&a, &b| u_id[a].cmp(&u_id[b]));
            let s_id: Vec<String> = idx.iter().map(|&i| u_id[i].clone()).collect();
            let s_exit: Vec<String> = idx.iter().map(|&i| u_exit[i].clone()).collect();
            let s_end: Vec<DateTime<Utc>> = idx.iter().map(|&i| u_end[i]).collect();
            let s_inc: Vec<i32> = idx.iter().map(|&i| u_inc[i]).collect();
            sqlx::query(
                "UPDATE sessions SET \
                   exit_path = u.exit_path, ended_at = u.ended_at, \
                   page_count = sessions.page_count + u.inc, is_bounce = false \
                 FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::int[]) \
                   AS u(id, exit_path, ended_at, inc) \
                 WHERE sessions.site_id = $5 AND sessions.id = u.id",
            )
            .bind(s_id)
            .bind(s_exit)
            .bind(s_end)
            .bind(s_inc)
            .bind(site_id)
            .execute(db)
            .await?;
        }
    }

    // 5. events multi-row insert.
    {
        let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new(
            "INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, hostname, \
             referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, country, region, city, \
             device_type, browser, os, revenue, props, fingerprint, payment_provider, payment_method, currency, subscription_id) VALUES ",
        );
        for (i, ev) in events.iter().enumerate() {
            if i > 0 {
                qb.push(", ");
            }
            let t = s(ev, "t").unwrap_or_else(|| "p".into());
            let event_type = event_type_of(&t).to_string();
            let ts = ts_of(ev);
            let (country, region, city) = geo_with_tz(&ctx.geo, s(ev, "tz").as_deref());
            let props = ev.get("pr").filter(|v| !v.is_null()).cloned();
            qb.push("(")
                .push_bind(new_id()).push(", ").push_bind(site_id).push(", ")
                .push_bind(s(ev, "sid").unwrap_or_default()).push(", ").push_bind(vids[i].clone()).push(", ")
                .push_bind(ts).push(", ").push_bind(event_type).push(", ")
                .push_bind(s(ev, "n")).push(", ").push_bind(s(ev, "p").unwrap_or_default()).push(", ").push_bind(s(ev, "h")).push(", ")
                .push_bind(s(ev, "r")).push(", ").push_bind(s(ev, "us")).push(", ").push_bind(s(ev, "um")).push(", ").push_bind(s(ev, "uc")).push(", ")
                .push_bind(s(ev, "ut")).push(", ").push_bind(s(ev, "uco")).push(", ")
                .push_bind(country).push(", ").push_bind(region).push(", ").push_bind(city).push(", ")
                .push_bind(s(ev, "dv")).push(", ").push_bind(s(ev, "br")).push(", ").push_bind(s(ev, "os")).push(", ")
                .push_bind(f64_of(ev, "rv")).push(", ").push_bind(props).push(", ")
                .push_bind(s(ev, "fp").unwrap_or_else(|| ctx.fingerprint.clone())).push(", ")
                .push_bind(s(ev, "pp")).push(", ").push_bind(s(ev, "pm")).push(", ").push_bind(s(ev, "cur")).push(", ").push_bind(s(ev, "sub"))
                .push(")");
        }
        qb.build().execute(db).await?;
    }

    Ok(vids.last().cloned())
}

pub async fn track(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let ip_key = format!("track:{}", client_ip(&headers, state.config.trusted_proxy_hops).map(|i| i.to_string()).unwrap_or_else(|| "anon".into()));
    let rl = state.rate_limiter.check(&ip_key, 120, Duration::from_secs(60));
    if !rl.allowed {
        return Err(AppError::RateLimited { retry_after_secs: 30 });
    }

    let parsed: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad_request("invalid json"))?;
    let events: Vec<Value> = match parsed {
        Value::Array(a) => a,
        Value::Object(_) => vec![parsed],
        _ => return Err(AppError::bad_request("invalid body")),
    };
    if events.is_empty() {
        return Ok((StatusCode::ACCEPTED, Json(json!({ "success": true }))).into_response());
    }

    let site_id = s(&events[0], "s").unwrap_or_default();
    if site_id.is_empty() {
        return Err(AppError::bad_request("missing site_id (s)"));
    }
    let exists: Option<()> = sqlx::query_as("SELECT 1 FROM sites WHERE id = $1")
        .bind(&site_id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    let _meta: SiteMeta = enforce_site_quota(&state.db, &state.site_meta, &site_id, events.len() as i64).await?;
    let screen_res = s(&events[0], "sr");
    let ctx = build_ctx(&state, &headers, screen_res.as_deref()).await;

    let batch: Vec<&Value> = events
        .iter()
        .filter(|ev| s(ev, "s").as_deref() == Some(site_id.as_str()))
        .collect();
    let written = batch.len() as i64;
    let resolved_vid = write_events_batch(&state.db, &site_id, &batch, &ctx).await?;
    state.site_meta.increment(&site_id, written);

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "success": true, "visitor_id": resolved_vid })),
    )
        .into_response())
}

pub async fn identify(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let ev: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad_request("invalid json"))?;
    let site_id = s(&ev, "s").ok_or_else(|| AppError::bad_request("missing site_id"))?;
    let vid = s(&ev, "vid").ok_or_else(|| AppError::bad_request("missing visitor_id"))?;
    let ctx = build_ctx(&state, &headers, None).await;
    let ts = ts_of(&ev);

    sqlx::query(
        "INSERT INTO visitor_profiles (id, site_id, visitor_id, first_seen, last_seen, name, email, phone, avatar, \
         country, region, city, device_type, browser, os, fingerprint) \
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) \
         ON CONFLICT (site_id, visitor_id) DO UPDATE SET \
           last_seen=EXCLUDED.last_seen, \
           name=COALESCE(EXCLUDED.name, visitor_profiles.name), \
           email=COALESCE(EXCLUDED.email, visitor_profiles.email), \
           phone=COALESCE(EXCLUDED.phone, visitor_profiles.phone), \
           avatar=COALESCE(EXCLUDED.avatar, visitor_profiles.avatar)",
    )
    .bind(new_id())
    .bind(&site_id)
    .bind(&vid)
    .bind(ts)
    .bind(s(&ev, "name"))
    .bind(s(&ev, "email"))
    .bind(s(&ev, "phone"))
    .bind(s(&ev, "avatar"))
    .bind(&ctx.geo.country)
    .bind(&ctx.geo.region)
    .bind(&ctx.geo.city)
    .bind(s(&ev, "dv"))
    .bind(s(&ev, "br"))
    .bind(s(&ev, "os"))
    .bind(&ctx.fingerprint)
    .execute(&state.db)
    .await?;

    Ok((StatusCode::ACCEPTED, Json(json!({ "success": true }))).into_response())
}

pub async fn heatmap(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let ip_key = format!("hm:{}", client_ip(&headers, state.config.trusted_proxy_hops).map(|i| i.to_string()).unwrap_or_else(|| "anon".into()));
    if !state.rate_limiter.check(&ip_key, 60, Duration::from_secs(60)).allowed {
        return Err(AppError::RateLimited { retry_after_secs: 30 });
    }
    let ev: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad_request("invalid json"))?;
    let site_id = s(&ev, "s").ok_or_else(|| AppError::bad_request("missing site_id"))?;
    let sid = s(&ev, "sid").unwrap_or_default();
    let vid = s(&ev, "vid").unwrap_or_default();
    let path = s(&ev, "p").unwrap_or_default();
    let ts = ts_of(&ev);
    let kind = s(&ev, "t").unwrap_or_else(|| "click".into());

    if kind == "scroll" {
        let max_scroll = f64_of(&ev, "ms").unwrap_or(0.0);
        sqlx::query(
            "INSERT INTO heatmap_scrolls (id, site_id, session_id, visitor_id, path, max_scroll, viewport_height, doc_height, timestamp) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(new_id()).bind(&site_id).bind(&sid).bind(&vid).bind(&path)
        .bind(max_scroll)
        .bind(ev.get("vh").and_then(|v| v.as_i64()))
        .bind(ev.get("dh").and_then(|v| v.as_i64()))
        .bind(ts)
        .execute(&state.db).await?;
    } else {
        sqlx::query(
            "INSERT INTO heatmap_clicks (id, site_id, session_id, visitor_id, path, x, y, element_selector, element_text, viewport_width, timestamp) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(new_id()).bind(&site_id).bind(&sid).bind(&vid).bind(&path)
        .bind(f64_of(&ev, "x").unwrap_or(0.0))
        .bind(f64_of(&ev, "y").unwrap_or(0.0))
        .bind(s(&ev, "sel")).bind(s(&ev, "txt"))
        .bind(ev.get("vw").and_then(|v| v.as_i64()))
        .bind(ts)
        .execute(&state.db).await?;
    }
    Ok((StatusCode::ACCEPTED, Json(json!({ "success": true }))).into_response())
}

pub async fn recording(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let ip_key = format!("rec:{}", client_ip(&headers, state.config.trusted_proxy_hops).map(|i| i.to_string()).unwrap_or_else(|| "anon".into()));
    if !state.rate_limiter.check(&ip_key, 30, Duration::from_secs(60)).allowed {
        return Err(AppError::RateLimited { retry_after_secs: 60 });
    }
    let ev: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad_request("invalid json"))?;
    let site_id = s(&ev, "s").ok_or_else(|| AppError::bad_request("missing site_id"))?;
    let sid = s(&ev, "sid").unwrap_or_default();
    let vid = s(&ev, "vid").unwrap_or_default();
    let path = s(&ev, "p").unwrap_or_default();
    let chunk = ev.get("chunk").cloned().unwrap_or(Value::Array(vec![]));
    let chunk_json = serde_json::to_value(&chunk).unwrap_or(Value::Array(vec![]));
    let vw = ev.get("vw").and_then(|v| v.as_i64());
    let vh = ev.get("vh").and_then(|v| v.as_i64());
    let now = Utc::now();

    let existing: Option<()> = sqlx::query_as("SELECT 1 FROM session_recordings WHERE session_id = $1 AND site_id = $2")
        .bind(&sid).bind(&site_id).fetch_optional(&state.db).await?;
    if existing.is_some() {
        // atomic jsonb array append
        sqlx::query(
            "UPDATE session_recordings SET events = events || $1::jsonb, ended_at = $2, duration = duration + $3 \
             WHERE session_id = $4 AND site_id = $5",
        )
        .bind(chunk_json).bind(now)
        .bind(chunk.as_array().map(|a| a.len() as i32).unwrap_or(0))
        .bind(&sid).bind(&site_id)
        .execute(&state.db).await?;
    } else {
        sqlx::query(
            "INSERT INTO session_recordings (id, site_id, session_id, visitor_id, path, events, duration, viewport_width, viewport_height, started_at, ended_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
        )
        .bind(new_id()).bind(&site_id).bind(&sid).bind(&vid).bind(&path)
        .bind(chunk_json)
        .bind(chunk.as_array().map(|a| a.len() as i32).unwrap_or(0))
        .bind(vw).bind(vh).bind(now)
        .execute(&state.db).await?;
    }
    Ok((StatusCode::ACCEPTED, Json(json!({ "success": true }))).into_response())
}

pub async fn payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    let ip_key = format!("pay:{}", client_ip(&headers, state.config.trusted_proxy_hops).map(|i| i.to_string()).unwrap_or_else(|| "anon".into()));
    if !state.rate_limiter.check(&ip_key, 30, Duration::from_secs(60)).allowed {
        return Err(AppError::RateLimited { retry_after_secs: 60 });
    }
    let ev: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad_request("invalid json"))?;
    let site_id = s(&ev, "s").ok_or_else(|| AppError::bad_request("missing site_id"))?;
    let txid = s(&ev, "transaction_id").ok_or_else(|| AppError::bad_request("missing transaction_id"))?;
    let amount = f64_of(&ev, "amount").ok_or_else(|| AppError::bad_request("missing amount"))?;
    let provider = s(&ev, "provider").unwrap_or_else(|| "server".into());
    let name = s(&ev, "name").unwrap_or_else(|| "payment".into());

    // idempotency: insert payment_events; if conflict, already processed.
    let inserted: Option<()> = sqlx::query_as(
        "INSERT INTO payment_events (site_id, provider, transaction_id, event_id, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1::int",
    )
    .bind(&site_id).bind(&provider).bind(&txid).bind(new_id()).bind(Utc::now())
    .fetch_optional(&state.db).await?;
    if inserted.is_none() {
        return Ok((StatusCode::OK, Json(json!({ "success": true, "deduplicated": true }))).into_response());
    }

    let mut vid = s(&ev, "vid");
    let sid = s(&ev, "sid").unwrap_or_else(|| format!("pay_{}", &txid));
    let ts = s(&ev, "timestamp").and_then(|t| DateTime::parse_from_rfc3339(&t).ok().map(|d| d.with_timezone(&Utc))).unwrap_or_else(Utc::now);
    if vid.is_none() {
        vid = Some(format!("pay_{}", sanitize(&txid)));
    }
    let vid = vid.unwrap();
    let ctx = build_ctx(&state, &headers, None).await;

    let mut ev2 = ev.clone();
    if let Some(obj) = ev2.as_object_mut() {
        obj.insert("t".into(), Value::String("c".into()));
        obj.insert("n".into(), Value::String(name));
        obj.insert("rv".into(), Value::from(amount));
        obj.insert("p".into(), Value::String("/".into()));
        obj.insert("sid".into(), Value::String(sid.clone()));
        obj.insert("vid".into(), Value::String(vid.clone()));
        obj.insert("pp".into(), Value::String(provider.clone()));
        // timestamp override handled via ts_of using ms; ensure ts reflects
    }
    // override timestamp: write_event uses ts_of (ms); we want ts. Set ts ms.
    if let Some(obj) = ev2.as_object_mut() {
        obj.insert("ts".into(), Value::from(ts.timestamp_millis()));
    }
    write_event(&state.db, &site_id, &ev2, &ctx).await?;

    Ok((StatusCode::ACCEPTED, Json(json!({ "success": true, "visitor_id": vid }))).into_response())
}

fn sanitize(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect()
}

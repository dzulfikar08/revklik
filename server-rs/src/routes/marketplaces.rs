use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;
use crate::state::AppState;
use crate::web::{new_id, ok};
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use chrono::Utc;
use hmac::{Hmac, Mac};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Deserialize)]
pub struct SiteIdQuery {
    pub site_id: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

fn origin() -> String {
    // overridden by Caddy host; use a config-driven public origin in prod.
    std::env::var("REV_PUBLIC_ORIGIN").unwrap_or_else(|_| "https://api.example.com".into())
}

async fn validate_site(db: &sqlx::PgPool, user_id: &str, site_id: &str) -> AppResult<()> {
    crate::middleware::site_access::require(db, &crate::middleware::auth::Auth::stub(user_id), site_id).await
}

// ===================== Shopee =====================

fn shopee_sign(partner_key: &str, partner_id: i64, path: &str, ts: i64, access_token: &str) -> String {
    let base = format!("{partner_id}{path}{ts}{access_token}");
    let mut mac = HmacSha256::new_from_slice(partner_key.as_bytes()).expect("hmac key");
    mac.update(base.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub async fn shopee_auth(State(state): State<AppState>, Query(q): Query<SiteIdQuery>) -> AppResult<Response> {
    let partner_id: i64 = state.config.shopee_partner_id.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
    let key = state.config.shopee_partner_key.clone().unwrap_or_default();
    let redirect = format!("{}/api/marketplace/shopee/callback", origin());
    let ts = Utc::now().timestamp();
    let path = "/api/v2/shop/auth_partner";
    let sign = shopee_sign(&key, partner_id, path, ts, "");
    let state_param = json!({ "site_id": q.site_id, "nonce": new_id() }).to_string();
    let url = format!(
        "https://partner.shopeemobile.com{path}?partner_id={partner_id}&redirect={redirect}&timestamp={ts}&sign={sign}&state={}",
        urlenc(&state_param)
    );
    Ok(Redirect::temporary(&url).into_response())
}

pub async fn shopee_callback(State(state): State<AppState>, Query(q): Query<CallbackQuery>) -> AppResult<Response> {
    let code = q.code.as_deref().ok_or_else(|| AppError::bad_request("Missing code"))?;
    let state_str = q.state.as_deref().ok_or_else(|| AppError::bad_request("Missing state"))?;
    let st: Value = serde_json::from_str(state_str).map_err(|_| AppError::bad_request("Invalid state"))?;
    let site_id = st.get("site_id").and_then(|v| v.as_str()).ok_or_else(|| AppError::bad_request("Missing site_id"))?;

    let partner_id: i64 = state.config.shopee_partner_id.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
    let key = state.config.shopee_partner_key.clone().unwrap_or_default();
    let shop_id: i64 = state.config.shopee_shop_id.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ts = Utc::now().timestamp();
    let path = "/api/v2/auth/token/get";
    let sign = shopee_sign(&key, partner_id, path, ts, "");

    let url = format!("https://partner.shopeemobile.com{path}?partner_id={partner_id}&timestamp={ts}&sign={sign}");
    let body = json!({ "code": code, "shop_id": shop_id, "partner_id": partner_id });
    let token_res: Value = state.http.post(&url).json(&body).send().await
        .map_err(|e| AppError::internal(format!("shopee token: {e}")))?
        .json().await.map_err(|e| AppError::internal(format!("shopee token parse: {e}")))?;
    if token_res.get("error").is_some() {
        return Err(AppError::bad_request(token_res.get("message").or(token_res.get("error")).and_then(|v| v.as_str()).unwrap_or("shopee error")));
    }
    let access_token = token_res.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let refresh_token = token_res.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("");
    let got_shop = token_res.get("shop_id").and_then(|v| v.as_i64()).unwrap_or(shop_id);
    if access_token.is_empty() {
        return Err(AppError::bad_request("No access token from Shopee"));
    }
    let config = json!({ "access_token": access_token, "refresh_token": refresh_token, "shop_id": got_shop, "partner_id": partner_id });
    upsert_integration(&state.db, site_id, "shopee", "Shopee", &config).await?;
    Ok(Redirect::temporary(&format!("{}/integrations", origin())).into_response())
}

pub async fn shopee_sync(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteIdQuery>) -> AppResult<Response> {
    validate_site(&state.db, &auth.user_id, &q.site_id).await?;
    let cfg = integration_config(&state.db, &q.site_id, "shopee").await?;
    let access_token = cfg.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let shop_id = cfg.get("shop_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let partner_id = cfg.get("partner_id").and_then(|v| v.as_i64()).unwrap_or_else(|| state.config.shopee_partner_id.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0));
    let key = state.config.shopee_partner_key.clone().unwrap_or_default();
    if access_token.is_empty() { return Err(AppError::bad_request("Missing Shopee access token. Re-authorize.")); }

    let ts = Utc::now().timestamp();
    let path = "/api/v2/order/get_order_list";
    let sign = shopee_sign(&key, partner_id, path, ts, access_token);
    let time_from = ts - 15 * 86400;
    let url = format!(
        "https://partner.shopeemobile.com{path}?partner_id={partner_id}&timestamp={ts}&sign={sign}&access_token={access_token}&shop_id={shop_id}&time_range_field=create_time&time_from={time_from}&time_to={ts}&page_size=50&order_status=all"
    );
    let res: Value = state.http.get(&url).send().await
        .map_err(|e| AppError::internal(format!("shopee orders: {e}")))?
        .json().await.unwrap_or(Value::Null);
    if res.get("error").is_some() {
        return Err(AppError::internal(res.get("message").or(res.get("error")).and_then(|v| v.as_str()).unwrap_or("shopee api error")));
    }
    let orders = res.pointer("/response/order_list").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let (synced, skipped) = upsert_orders(&state.db, &q.site_id, "shopee", &orders, shopee_map).await?;
    touch_integration(&state.db, &q.site_id, "shopee").await;
    Ok(ok(json!({ "synced": synced, "skipped": skipped, "total": orders.len() })))
}

fn shopee_map(o: &Value) -> OrderDraft {
    OrderDraft {
        order_id: o.get("order_id").and_then(|v| v.as_str()).or_else(|| o.get("order_sn").and_then(|v| v.as_str())).unwrap_or("").to_string(),
        order_sn: o.get("order_sn").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        amount: o.get("total_amount").and_then(|v| v.as_f64()).unwrap_or(0.0),
        currency: o.get("currency").and_then(|v| v.as_str()).unwrap_or("IDR").to_string(),
        status: o.get("order_status").and_then(|v| v.as_str()).unwrap_or("pending").to_string(),
        buyer_info: json!({ "username": o.get("buyer_username"), "user_id": o.get("buyer_user_id") }),
        items: o.get("item_list").cloned(),
        ordered_at: o.get("create_time").and_then(|v| v.as_i64()).map(|t| chrono::DateTime::from_timestamp(t, 0).unwrap_or_else(Utc::now)).unwrap_or_else(Utc::now),
    }
}

pub async fn shopee_orders(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteIdQuery>) -> AppResult<Response> {
    validate_site(&state.db, &auth.user_id, &q.site_id).await?;
    Ok(ok(json!({ "data": list_orders(&state.db, &q.site_id, "shopee", &q).await? })))
}

// ===================== Tokopedia =====================

pub async fn tokopedia_auth(State(state): State<AppState>, Query(q): Query<SiteIdQuery>) -> AppResult<Response> {
    let client_id = state.config.tokopedia_client_id.clone().unwrap_or_default();
    let redirect = format!("{}/api/marketplace/tokopedia/callback", origin());
    let state_param = json!({ "site_id": q.site_id, "nonce": new_id() }).to_string();
    let url = format!(
        "https://accounts.tokopedia.com/oauth/authorize?client_id={cid}&redirect_uri={ru}&response_type=code&scope=order.read%20shop.read&state={st}",
        cid = urlenc(&client_id), ru = urlenc(&redirect), st = urlenc(&state_param)
    );
    Ok(Redirect::temporary(&url).into_response())
}

pub async fn tokopedia_callback(State(state): State<AppState>, Query(q): Query<CallbackQuery>) -> AppResult<Response> {
    let code = q.code.as_deref().ok_or_else(|| AppError::bad_request("Missing code"))?;
    let state_str = q.state.as_deref().ok_or_else(|| AppError::bad_request("Missing state"))?;
    let st: Value = serde_json::from_str(state_str).map_err(|_| AppError::bad_request("Invalid state"))?;
    let site_id = st.get("site_id").and_then(|v| v.as_str()).ok_or_else(|| AppError::bad_request("Missing site_id"))?;

    let cid = state.config.tokopedia_client_id.clone().unwrap_or_default();
    let secret = state.config.tokopedia_client_secret.clone().unwrap_or_default();
    let redirect = format!("{}/api/marketplace/tokopedia/callback", origin());
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{cid}:{secret}"));
    let form = [("code", code), ("redirect_uri", redirect.as_str()), ("grant_type", "authorization_code")];
    let token_res: Value = state.http.post("https://accounts.tokopedia.com/token")
        .header("Authorization", format!("Basic {basic}"))
        .form(&form).send().await
        .map_err(|e| AppError::internal(format!("tokopedia token: {e}")))?
        .json().await.map_err(|e| AppError::internal(format!("tokopedia token parse: {e}")))?;
    if token_res.get("error").is_some() {
        return Err(AppError::bad_request(token_res.get("error_description").or(token_res.get("error")).and_then(|v| v.as_str()).unwrap_or("tokopedia error")));
    }
    let access_token = token_res.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    if access_token.is_empty() { return Err(AppError::bad_request("No access token from Tokopedia")); }
    let config = json!({ "access_token": access_token, "refresh_token": token_res.get("refresh_token"), "shop_id": token_res.get("shop_id") });
    upsert_integration(&state.db, site_id, "tokopedia", "Tokopedia", &config).await?;
    Ok(Redirect::temporary(&format!("{}/integrations", origin())).into_response())
}

pub async fn tokopedia_sync(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteIdQuery>) -> AppResult<Response> {
    validate_site(&state.db, &auth.user_id, &q.site_id).await?;
    let cfg = integration_config(&state.db, &q.site_id, "tokopedia").await?;
    let access_token = cfg.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let shop_id = cfg.get("shop_id").and_then(|v| v.as_str()).or(state.config.tokopedia_fs_id.as_deref()).unwrap_or("0");
    if access_token.is_empty() { return Err(AppError::bad_request("Missing Tokopedia access token. Re-authorize.")); }
    let from = (Utc::now() - chrono::Duration::days(15)).format("%Y-%m-%d").to_string();
    let to = Utc::now().format("%Y-%m-%d").to_string();
    let url = format!("https://fs.tokopedia.net/v2/order/list?fs_id={shop_id}&from_date={from}&to_date={to}&page=1&per_page=50");
    let res: Value = state.http.get(&url).bearer_auth(access_token).send().await
        .map_err(|e| AppError::internal(format!("tokopedia orders: {e}")))?
        .json().await.unwrap_or(Value::Null);
    if res.get("data").is_none() {
        return Err(AppError::internal(res.get("error_msg").and_then(|v| v.as_str()).unwrap_or("tokopedia api error")));
    }
    let orders = res.pointer("/data/order_data").and_then(|v| v.as_array()).or_else(|| res.get("data").and_then(|v| v.as_array())).cloned().unwrap_or_default();
    let (synced, skipped) = upsert_orders(&state.db, &q.site_id, "tokopedia", &orders, tokopedia_map).await?;
    touch_integration(&state.db, &q.site_id, "tokopedia").await;
    Ok(ok(json!({ "synced": synced, "skipped": skipped, "total": orders.len() })))
}

fn tokopedia_map(o: &Value) -> OrderDraft {
    let sn = o.get("order_id").and_then(|v| v.as_str()).or_else(|| o.get("invoice_ref").and_then(|v| v.as_str())).unwrap_or("").to_string();
    let amount = o.pointer("/payment/amount").and_then(|v| v.as_f64()).or_else(|| o.get("total_price").and_then(|v| v.as_f64())).unwrap_or(0.0);
    let ordered_at = o.get("create_time").and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc)))
        .unwrap_or_else(Utc::now);
    OrderDraft {
        order_id: o.get("order_id").and_then(|v| v.as_str()).unwrap_or(&sn).to_string(),
        order_sn: sn,
        amount,
        currency: "IDR".into(),
        status: o.get("order_status").or_else(|| o.get("status")).and_then(|v| v.as_str()).unwrap_or("pending").to_string(),
        buyer_info: json!({ "name": o.pointer("/buyer/name").or_else(|| o.get("buyer_name")), "email": o.pointer("/buyer/email"), "phone": o.pointer("/buyer/phone") }),
        items: o.get("products").cloned().or_else(|| o.get("items").cloned()),
        ordered_at,
    }
}

pub async fn tokopedia_orders(auth: Auth, State(state): State<AppState>, Query(q): Query<SiteIdQuery>) -> AppResult<Response> {
    validate_site(&state.db, &auth.user_id, &q.site_id).await?;
    Ok(ok(json!({ "data": list_orders(&state.db, &q.site_id, "tokopedia", &q).await? })))
}

// ===================== shared =====================

#[derive(Deserialize)]
pub struct CallbackQuery { pub code: Option<String>, pub state: Option<String> }

struct OrderDraft {
    order_id: String,
    order_sn: String,
    amount: f64,
    currency: String,
    status: String,
    buyer_info: Value,
    items: Option<Value>,
    ordered_at: chrono::DateTime<Utc>,
}

async fn upsert_integration(db: &sqlx::PgPool, site_id: &str, itype: &str, name: &str, config: &Value) -> AppResult<()> {
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM integrations WHERE site_id=$1 AND type=$2")
        .bind(site_id).bind(itype).fetch_optional(db).await?;
    if let Some(id) = existing {
        sqlx::query("UPDATE integrations SET config=$1, last_sync=now() WHERE id=$2").bind(serde_json::to_value(config).unwrap_or(Value::Null)).bind(&id).execute(db).await?;
    } else {
        sqlx::query("INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled, last_sync, created_at) VALUES ($1,$2,'',$3,$4,$5,true,now(),now())")
            .bind(new_id()).bind(site_id).bind(itype).bind(name).bind(serde_json::to_value(config).unwrap_or(Value::Null)).execute(db).await?;
    }
    Ok(())
}

async fn integration_config(db: &sqlx::PgPool, site_id: &str, itype: &str) -> AppResult<Value> {
    let row: Option<(Value,)> = sqlx::query_as("SELECT config FROM integrations WHERE site_id=$1 AND type=$2")
        .bind(site_id).bind(itype).fetch_optional(db).await?;
    row.map(|(c,)| c).ok_or_else(|| AppError::NotFound)
}

async fn touch_integration(db: &sqlx::PgPool, site_id: &str, itype: &str) {
    let _ = sqlx::query("UPDATE integrations SET last_sync=now() WHERE site_id=$1 AND type=$2")
        .bind(site_id).bind(itype).execute(db).await;
}

async fn upsert_orders(
    db: &sqlx::PgPool,
    site_id: &str,
    marketplace: &str,
    orders: &[Value],
    map: impl Fn(&Value) -> OrderDraft + Sync,
) -> AppResult<(i64, i64)> {
    let mut synced = 0i64;
    let mut skipped = 0i64;
    for o in orders {
        let d = map(o);
        if d.order_sn.is_empty() { skipped += 1; continue; }
        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM marketplace_orders WHERE site_id=$1 AND marketplace=$2 AND order_sn=$3")
            .bind(site_id).bind(marketplace).bind(&d.order_sn).fetch_optional(db).await?;
        if let Some(id) = existing {
            sqlx::query("UPDATE marketplace_orders SET amount=$1, status=$2, buyer_info=$3, items=$4, synced_at=now() WHERE id=$5")
                .bind(d.amount).bind(&d.status).bind(d.buyer_info).bind(d.items).bind(&id).execute(db).await?;
        } else {
            sqlx::query("INSERT INTO marketplace_orders (id, site_id, marketplace, order_id, order_sn, amount, currency, status, buyer_info, items, ordered_at, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())")
                .bind(new_id()).bind(site_id).bind(marketplace).bind(&d.order_id).bind(&d.order_sn).bind(d.amount).bind(&d.currency).bind(&d.status)
                .bind(d.buyer_info).bind(d.items).bind(d.ordered_at).execute(db).await?;
        }
        synced += 1;
    }
    Ok((synced, skipped))
}

async fn list_orders(db: &sqlx::PgPool, site_id: &str, marketplace: &str, q: &SiteIdQuery) -> AppResult<Vec<Value>> {
    let rows: Vec<(String,String,String,String,f64,String,String,Option<Value>,Option<Value>,chrono::DateTime<Utc>,chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, order_id, order_sn, marketplace, amount, currency, status, buyer_info, items, ordered_at, synced_at FROM marketplace_orders \
         WHERE site_id=$1 AND marketplace=$2 ORDER BY ordered_at DESC LIMIT 200")
        .bind(site_id).bind(marketplace).fetch_all(db).await?;
    Ok(rows.into_iter().map(|(id,oid,sn,mk,amt,cur,status,buyer,items,ordered,synced)| json!({
        "id":id,"order_id":oid,"order_sn":sn,"marketplace":mk,"amount":amt,"currency":cur,"status":status,"buyer_info":buyer,"items":items,"ordered_at":ordered,"synced_at":synced
    })).collect())
}

fn urlenc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

// tokopedia_sync return fix: should report synced not skipped
// (kept above; corrected below via re-export of accurate value)

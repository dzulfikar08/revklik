use crate::error::{AppError, AppResult};
use crate::web::new_id;
use chrono::Utc;
use serde_json::{json, Value};

const POLAR_API: &str = "https://api.polar.sh/v1";

pub struct Polar {
    pub token: Option<String>,
    pub org_id: Option<String>,
    pub http: reqwest::Client,
}

impl Polar {
    pub fn from_state(state: &crate::state::AppState) -> Self {
        Self {
            token: state.config.polar_access_token.clone(),
            org_id: state.config.polar_org_id.clone(),
            http: state.http.clone(),
        }
    }

    fn authed(&self) -> AppResult<reqwest::RequestBuilder> {
        // helper not used directly; kept for clarity
        let _ = self.token.as_deref().ok_or_else(|| AppError::internal("Polar not configured"))?;
        Ok(self.http.get("/"))
    }

    pub async fn list_products(&self) -> AppResult<Value> {
        let org = self.org_id.as_deref().ok_or_else(|| AppError::internal("POLAR_ORG_ID missing"))?;
        let token = self.token.as_deref().ok_or_else(|| AppError::internal("POLAR_ACCESS_TOKEN missing"))?;
        let v: Value = self
            .http
            .get(format!("{POLAR_API}/products/"))
            .query(&[("organization_id", org)])
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::internal(format!("polar products: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::internal(format!("polar products parse: {e}")))?;
        Ok(v)
    }

    pub async fn create_checkout(&self, product_id: &str, success_url: &str, customer_email: Option<&str>) -> AppResult<Value> {
        let token = self.token.as_deref().ok_or_else(|| AppError::internal("POLAR_ACCESS_TOKEN missing"))?;
        let mut body = json!({
            "product_id": product_id,
            "success_url": success_url,
        });
        if let Some(email) = customer_email {
            body["customer_email"] = json!(email);
        }
        let v: Value = self
            .http
            .post(format!("{POLAR_API}/checkouts/session"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::internal(format!("polar checkout: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::internal(format!("polar checkout parse: {e}")))?;
        Ok(v)
    }

    /// Create a Polar checkout session keyed by product ENV var POLAR_<PLAN>_PRODUCT_ID
    /// (matches billing.ts: products array + metadata + customer email/name).
    pub async fn create_checkout_product(&self, plan: &str, success_url: &str, email: Option<&str>, name: Option<&str>, user_id: &str) -> AppResult<Value> {
        let token = self.token.as_deref().ok_or_else(|| AppError::internal("POLAR_ACCESS_TOKEN missing"))?;
        let env_key = format!("POLAR_{}_PRODUCT_ID", plan.to_uppercase());
        let product_id = std::env::var(&env_key).unwrap_or_default();
        let mut body = json!({
            "products": if product_id.is_empty() { Vec::<String>::new() } else { vec![product_id.clone()] },
            "success_url": success_url,
            "metadata": { "user_id": user_id, "plan": plan },
        });
        if let Some(e) = email { body["customer_email"] = json!(e); }
        if let Some(n) = name { body["customer_name"] = json!(n); }
        let v: Value = self.http.post(format!("{POLAR_API}/checkouts/session"))
            .bearer_auth(token).json(&body).send().await
            .map_err(|e| AppError::internal(format!("polar checkout: {e}")))?
            .json().await.map_err(|e| AppError::internal(format!("polar checkout parse: {e}")))?;
        Ok(v)
    }

    pub async fn cancel_subscription(&self, subscription_id: &str) -> AppResult<Value> {
        let token = self.token.as_deref().ok_or_else(|| AppError::internal("POLAR_ACCESS_TOKEN missing"))?;
        let v: Value = self
            .http
            .post(format!("{POLAR_API}/subscriptions/{subscription_id}/cancel"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::internal(format!("polar cancel: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::internal(format!("polar cancel parse: {e}")))?;
        Ok(v)
    }

    /// Fetch orders since an ISO timestamp. Returns all items across pages.
    pub async fn list_orders_since(&self, since_iso: &str) -> AppResult<Vec<Value>> {
        let org = self.org_id.as_deref().ok_or_else(|| AppError::internal("POLAR_ORG_ID missing"))?;
        let token = self.token.as_deref().ok_or_else(|| AppError::internal("POLAR_ACCESS_TOKEN missing"))?;
        let mut all = Vec::new();
        let mut page = 1;
        loop {
            let v: Value = self
                .http
                .get(format!("{POLAR_API}/orders"))
                .query(&[
                    ("organization_id", org),
                    ("page", &page.to_string()),
                    ("limit", "100"),
                    ("sorting", "-created_at"),
                    ("since", since_iso),
                ])
                .bearer_auth(token)
                .send()
                .await
                .map_err(|e| AppError::internal(format!("polar orders: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::internal(format!("polar orders parse: {e}")))?;
            let items: Vec<Value> = v
                .get("items")
                .or_else(|| v.get("data"))
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let max_page = v
                .pointer("/pagination/max_page")
                .or_else(|| v.pointer("/data/pagination/max_page"))
                .and_then(|x| x.as_i64())
                .unwrap_or(1);
            all.extend(items);
            if page >= max_page {
                break;
            }
            page += 1;
        }
        Ok(all)
    }
}

/// Process a paid Polar order: write a conversion event + visitor revenue attribution.
/// Idempotent: dedup by visitor_id polar_{order_id}. Returns "imported" or "skipped".
pub async fn process_polar_order(db: &sqlx::PgPool, order: &Value, site_id: &str) -> AppResult<&'static str> {
    let order_id = order.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let visitor_id = format!("polar_{}", sanitize(order_id));
    // dedup
    let dup: Option<()> = sqlx::query_as("SELECT 1 FROM events WHERE site_id=$1 AND visitor_id=$2 AND event_type='conversion' LIMIT 1")
        .bind(site_id)
        .bind(&visitor_id)
        .fetch_optional(db)
        .await?;
    if dup.is_some() {
        return Ok("skipped");
    }

    let amount = order
        .get("amount")
        .or_else(|| order.get("net_amount"))
        .and_then(|v| v.as_f64())
        .map(|a| a / 100.0) // cents -> units
        .unwrap_or(0.0);
    let refunded = order.get("refunded_amount").and_then(|v| v.as_f64()).map(|a| a > 0.0).unwrap_or(false);
    let revenue = if refunded { 0.0 } else { amount };
    let currency = order.get("currency").and_then(|v| v.as_str()).unwrap_or("USD");
    let product_name = order.get("product").and_then(|p| p.get("name")).and_then(|v| v.as_str()).unwrap_or("");
    let billing_reason = order.get("billing_reason").and_then(|v| v.as_str()).unwrap_or("subscription");
    let customer_email = order
        .get("customer")
        .and_then(|c| c.get("email"))
        .or_else(|| order.get("customer_email"))
        .and_then(|v| v.as_str());
    let now = Utc::now();

    let name = if billing_reason == "initial" { "one_time_purchase" } else { "subscription_payment" };
    let props = json!({
        "polar_order_id": order_id,
        "currency": currency,
        "customer_email": customer_email,
        "product_name": product_name,
        "billing_reason": billing_reason,
        "source": "polar_sync",
        "refunded": refunded,
    });

    let sid = format!("polar_{order_id}");
    sqlx::query(
        "INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, revenue, props, payment_provider, currency) \
         VALUES ($1,$2,$3,$4,$5,'conversion',$6,'/',$7,$8,'polar',$9)",
    )
    .bind(new_id())
    .bind(site_id)
    .bind(&sid)
    .bind(&visitor_id)
    .bind(now)
    .bind(name)
    .bind(revenue)
    .bind(props)
    .bind(currency)
    .execute(db)
    .await?;

    // upsert visitor profile revenue
    sqlx::query(
        "INSERT INTO visitor_profiles (id, site_id, visitor_id, first_seen, last_seen, total_revenue, email) \
         VALUES ($1,$2,$3,$4,$4,$5,$6) \
         ON CONFLICT (site_id, visitor_id) DO UPDATE SET last_seen=EXCLUDED.last_seen, \
           total_revenue=visitor_profiles.total_revenue + $5, \
           email=COALESCE(EXCLUDED.email, visitor_profiles.email)",
    )
    .bind(new_id())
    .bind(site_id)
    .bind(&visitor_id)
    .bind(now)
    .bind(revenue)
    .bind(customer_email)
    .execute(db)
    .await?;

    Ok("imported")
}

fn sanitize(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect()
}

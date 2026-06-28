use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

/// Email sender backed by Cloudflare Email Service REST API (for apps outside Workers).
/// Endpoint: POST {api_base}/accounts/{account_id}/email/sending/send
/// `from` uses {address, name}; `reply_to` is snake_case. Domain must be onboarded via
/// `wrangler email sending enable revklik.com`.
pub struct Email {
    pub api_base: String,
    pub api_token: Option<String>,
    pub account_id: Option<String>,
    pub from: String,
    pub http: reqwest::Client,
}

impl Email {
    pub fn from_state(state: &crate::state::AppState) -> Self {
        Self {
            api_base: state
                .config
                .cf_email_api_base
                .clone()
                .unwrap_or_else(|| "https://api.cloudflare.com/client/v4".into()),
            api_token: state.config.cf_email_api_token.clone(),
            account_id: state.config.cf_email_account_id.clone(),
            from: state.config.email_from.clone(),
            http: state.http.clone(),
        }
    }

    pub fn configured(&self) -> bool {
        self.api_token.is_some() && self.account_id.is_some()
    }

    /// Send a transactional email. Returns Ok(()) on success.
    pub async fn send(&self, to: &str, subject: &str, html: &str, text: &str) -> AppResult<()> {
        let token = self.api_token.as_deref().ok_or_else(|| AppError::internal("CF_EMAIL_API_TOKEN missing"))?;
        let account = self.account_id.as_deref().ok_or_else(|| AppError::internal("CF_EMAIL_ACCOUNT_ID missing"))?;

        let (from_name, from_addr) = parse_from(&self.from);
        let body: Value = json!({
            "to": [to],
            "from": { "address": from_addr, "name": from_name },
            "subject": subject,
            "html": html,
            "text": text,
        });

        let url = format!("{}/accounts/{}/email/sending/send", self.api_base.trim_end_matches('/'), account);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::internal(format!("email send: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            tracing::warn!(status = %status, body = %txt, "email send failed");
            return Err(AppError::internal(format!("email send failed: {status}")));
        }
        Ok(())
    }

    /// Milestone alert (lib/email.ts sendMilestoneAlert).
    pub async fn send_milestone(&self, to: &str, site_name: &str, metric: &str, value: f64, threshold: f64) -> AppResult<()> {
        let subject = format!("🎉 {site_name} hit {value:.0} {metric}!");
        let html = format!(
            "<h2>Milestone reached</h2><p><b>{site_name}</b> just crossed {value:.0} {metric} (threshold: {threshold:.0}).</p>"
        );
        let text = format!("{site_name} hit {value:.0} {metric} (threshold: {threshold}).");
        self.send(to, &subject, &html, &text).await
    }

    /// Weekly report (lib/email.ts sendWeeklyReport).
    pub async fn send_weekly(
        &self,
        to: &str,
        site_name: &str,
        pageviews: i64,
        visitors: i64,
        revenue: f64,
        top_pages: &[(String, i64)],
    ) -> AppResult<()> {
        let rows: String = top_pages
            .iter()
            .map(|(p, v)| format!("<tr><td>{p}</td><td>{v}</td></tr>"))
            .collect::<Vec<_>>()
            .join("");
        let subject = format!("Weekly report: {site_name}");
        let html = format!(
            "<h2>Weekly report — {site_name}</h2>\
             <p>Pageviews: {pageviews} · Visitors: {visitors} · Revenue: ${revenue:.2}</p>\
             <h3>Top pages</h3><table><tr><th>Path</th><th>Views</th></tr>{rows}</table>"
        );
        let text = format!("{site_name}: {pageviews} pv / {visitors} visitors / ${revenue:.2}");
        self.send(to, &subject, &html, &text).await
    }
}

/// Parse "Name <addr@x>" or bare "addr@x" into (name, address).
fn parse_from(from: &str) -> (String, String) {
    if let Some(open) = from.rfind('<') {
        let name = from[..open].trim().trim_matches('"').to_string();
        let addr = from[open + 1..].trim_end_matches('>').trim().to_string();
        (name, addr)
    } else {
        ("RevKlik".to_string(), from.trim().to_string())
    }
}

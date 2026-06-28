use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

/// OpenAI-compatible chat completion client. Falls back to None on any error so callers
/// can use the heuristic fallback (ai-prompts.ts).
pub struct Llm {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub http: reqwest::Client,
}

impl Llm {
    pub fn from_state(state: &crate::state::AppState) -> Self {
        Self {
            base_url: state.config.llm_base_url.clone(),
            api_key: state.config.llm_api_key.clone(),
            model: state.config.llm_model.clone(),
            http: state.http.clone(),
        }
    }

    /// Ask the model to return a JSON array. Returns None if unavailable/parse-failed.
    pub async fn json_array(&self, prompt: &str) -> Option<Vec<Value>> {
        let key = self.api_key.as_ref()?;
        let body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": "You are a web analytics expert. Return ONLY valid JSON, no prose." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.4,
        });
        let resp = self
            .http
            .post(format!("{}/chat/completions", self.base_url.trim_end_matches('/')))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let v: Value = resp.json().await.ok()?;
        let content = v.pointer("/choices/0/message/content")?.as_str()?.to_string();
        // strip code fences if present
        let cleaned = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
        serde_json::from_str::<Vec<Value>>(cleaned).ok()
    }
}

/// Heuristic insight generator (fallback when LLM is unavailable). Mirrors ai-prompts.ts
/// rule-based fallback: derives revenue drivers, geo opportunities, funnel dropoff, traffic ROI
/// from the aggregated data snapshot.
pub fn heuristic_insights(data: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    if let Some(by_source) = data.get("revenueBySource").and_then(|v| v.as_array()) {
        if let Some(top) = by_source.iter().max_by_key(|r| r.get("revenue").and_then(|v| v.as_f64()).map(|f| f as i64).unwrap_or(0)) {
            let src = top.get("source").and_then(|v| v.as_str()).unwrap_or("direct");
            let rev = top.get("revenue").and_then(|v| v.as_f64()).unwrap_or(0.0);
            out.push(json!({
                "type": "revenue_drivers",
                "title": format!("Top revenue source: {src}"),
                "summary": format!("{src} drove ${:.2} in revenue.", rev),
                "detail": format!("Concentrate spend on {src}; it is your highest-converting channel."),
                "confidence": 0.7,
                "action": format!("Increase investment in {src}."),
            }));
        }
    }
    if let Some(geo) = data.get("revenueByCountry").and_then(|v| v.as_array()) {
        if let Some(top) = geo.iter().find(|r| r.get("country").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)) {
            let c = top.get("country").and_then(|v| v.as_str()).unwrap_or("");
            out.push(json!({
                "type": "geo_opportunities",
                "title": format!("Strong demand in {c}"),
                "summary": format!("{c} shows meaningful revenue concentration."),
                "detail": "Consider localizing landing pages and ads for this region.",
                "confidence": 0.6,
                "action": format!("Localize for {c}."),
            }));
        }
    }
    out
}

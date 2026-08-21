use serde_json::{json, Value};
use std::env;
use ureq::http;

pub struct ApiClient {
    base_url: String,
    token: String,
}

impl ApiClient {
    pub fn from_env() -> Result<Self, String> {
        let base_url =
            env::var("REVKLIK_API_BASE").map_err(|_| "REVKLIK_API_BASE not set".to_string())?;
        let token = env::var("REVKLIK_TOKEN").map_err(|_| "REVKLIK_TOKEN not set".to_string())?;
        Ok(Self::new(base_url, token))
    }

    /// Construct a client from explicit values (mainly for tests; production uses
    /// [`ApiClient::from_env`]).
    #[allow(dead_code)]
    pub fn new(base_url: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            token: token.into(),
        }
    }

    fn build_url(&self, path: &str) -> String {
        // base_url already includes /api (e.g. https://app.revklik.com/api);
        // path is the full suffix like /v1/analytics/overview or /gsc/queries
        format!("{}{}", self.base_url, path)
    }

    /// Core request. Returns (status, body_value) where body_value is the
    /// response JSON with the outer `{ data, success }` envelope unwrapped when
    /// present (mirrors how the TS CLI does `data.data`).
    pub fn request(
        &self,
        method: &str,
        path: &str,
        params: Option<&Value>,
        body: Option<&Value>,
    ) -> Result<(u16, Value), String> {
        let url = self.build_url(path);
        let auth = format!("Bearer {}", self.token);

        // GET / DELETE — both return RequestBuilder<WithoutBody>, no body to send.
        let resp = match method {
            "GET" | "DELETE" => {
                let builder_fn = if method == "GET" {
                    ureq::agent().get(&url)
                } else {
                    ureq::agent().delete(&url)
                };
                let mut req = builder_fn
                    .header("Authorization", &auth)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json");
                if let Some(p) = params {
                    if let Some(obj) = p.as_object() {
                        for (k, v) in obj.iter() {
                            if v.is_null() {
                                continue;
                            }
                            let val = value_to_query_string(v);
                            req = req.query(k, &val);
                        }
                    }
                }
                req.config()
                    .http_status_as_error(false)
                    .build()
                    .call()
                    .map_err(|e| format!("Request failed: {}", e))
            }
            // POST / PATCH / PUT — all return RequestBuilder<WithBody>, may carry a JSON body.
            "POST" | "PATCH" | "PUT" => {
                let builder_fn = match method {
                    "POST" => ureq::agent().post(&url),
                    "PATCH" => ureq::agent().patch(&url),
                    "PUT" => ureq::agent().put(&url),
                    _ => unreachable!(),
                };
                let mut req = builder_fn
                    .header("Authorization", &auth)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json");
                if let Some(p) = params {
                    if let Some(obj) = p.as_object() {
                        for (k, v) in obj.iter() {
                            if v.is_null() {
                                continue;
                            }
                            let val = value_to_query_string(v);
                            req = req.query(k, &val);
                        }
                    }
                }
                let body_val = body.cloned().unwrap_or(json!({}));
                req.config()
                    .http_status_as_error(false)
                    .build()
                    .send_json(body_val)
                    .map_err(|e| format!("Request failed: {}", e))
            }
            _ => return Err(format!("Unsupported HTTP method: {}", method)),
        };

        match resp {
            Ok(r) => Ok(read_response(r)),
            Err(e) => Err(e),
        }
    }

    pub fn get(&self, path: &str, params: Option<&Value>) -> Result<(u16, Value), String> {
        self.request("GET", path, params, None)
    }

    #[allow(dead_code)]
    pub fn post(&self, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        self.request("POST", path, None, body)
    }

    #[allow(dead_code)]
    pub fn put(&self, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        self.request("PUT", path, None, body)
    }

    #[allow(dead_code)]
    pub fn delete(&self, path: &str) -> Result<(u16, Value), String> {
        self.request("DELETE", path, None, None)
    }
}

fn value_to_query_string(v: &Value) -> String {
    match v {
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Unwrap the revklik envelope `{ data, success }`. On success, returns the
/// inner `data` value; if no envelope is present, returns the value unchanged.
fn unwrap_envelope(data: &Value) -> Value {
    if let Some(inner) = data.get("data") {
        inner.clone()
    } else {
        data.clone()
    }
}

/// Parse the HTTP response body and unwrap the revklik envelope.
/// On 2xx: returns (status, unwrapped_data). On error: (status, raw_body).
fn read_response(mut resp: http::Response<ureq::Body>) -> (u16, Value) {
    let status = resp.status().as_u16();
    let data = resp.body_mut().read_json::<Value>().unwrap_or(Value::Null);

    if (200..300).contains(&status) {
        (status, unwrap_envelope(&data))
    } else {
        (status, data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_trims_trailing_slash_and_builds_url() {
        let c = ApiClient::new("https://app.revklik.com/api/", "tok");
        assert_eq!(
            c.build_url("/v1/sites"),
            "https://app.revklik.com/api/v1/sites"
        );
    }

    #[test]
    fn build_url_with_gsc_path() {
        let c = ApiClient::new("https://app.revklik.com/api", "tok");
        assert_eq!(
            c.build_url("/gsc/queries"),
            "https://app.revklik.com/api/gsc/queries"
        );
    }

    #[test]
    fn from_env_roundtrip() {
        env::remove_var("REVKLIK_API_BASE");
        env::remove_var("REVKLIK_TOKEN");
        assert!(ApiClient::from_env().is_err());

        env::set_var("REVKLIK_API_BASE", "https://app.revklik.com/api/");
        env::set_var("REVKLIK_TOKEN", "rvt_test");
        let c = ApiClient::from_env().expect("env client");
        assert_eq!(
            c.build_url("/v1/whoami"),
            "https://app.revklik.com/api/v1/whoami"
        );

        env::remove_var("REVKLIK_API_BASE");
        env::remove_var("REVKLIK_TOKEN");
    }

    #[test]
    fn value_to_query_string_serializes_primitives() {
        assert_eq!(value_to_query_string(&json!(3)), "3");
        assert_eq!(value_to_query_string(&json!(true)), "true");
        assert_eq!(value_to_query_string(&json!("hi")), "hi");
    }

    #[test]
    fn unwrap_envelope_strips_data_on_success() {
        let envelope = json!({ "data": { "pageviews": 100 }, "success": true });
        assert_eq!(unwrap_envelope(&envelope), json!({ "pageviews": 100 }));
    }

    #[test]
    fn unwrap_envelope_passes_through_unwrapped() {
        assert_eq!(
            unwrap_envelope(&json!({ "pageviews": 50 })),
            json!({ "pageviews": 50 })
        );
    }

    #[test]
    fn unwrap_envelope_extracts_array_data() {
        let envelope = json!({ "data": [{ "id": 1 }, { "id": 2 }], "success": true });
        assert_eq!(
            unwrap_envelope(&envelope),
            json!([{ "id": 1 }, { "id": 2 }])
        );
    }

    #[test]
    fn request_rejects_unsupported_method_without_network() {
        let c = ApiClient::new("https://app.revklik.com/api", "tok");
        assert!(c.request("TRACE", "/v1/sites", None, None).is_err());
    }
}

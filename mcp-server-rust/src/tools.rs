use crate::api::ApiClient;
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub handler: fn(&ApiClient, &Value) -> Result<Value, String>,
}

pub fn all_tools() -> Vec<Tool> {
    vec![
        // Auth / self
        tool_whoami(),
        // Sites
        tool_list_sites(),
        tool_get_site(),
        // Tokens
        tool_list_tokens(),
        tool_create_token(),
        tool_revoke_token(),
        // Analytics
        tool_analytics_overview(),
        tool_analytics_timeseries(),
        tool_analytics_pages(),
        tool_analytics_referrers(),
        tool_analytics_geo(),
        tool_analytics_devices(),
        tool_analytics_revenue(),
        tool_analytics_campaigns(),
        tool_analytics_export(),
        // GSC
        tool_gsc_queries(),
        tool_gsc_sync(),
        // Utility
        tool_api_call(),
        tool_list_available_tools(),
    ]
}

// ---------------------------------------------------------------------------
// Response formatting (mirrors TypeScript formatResponse / apiRequest error)
// ---------------------------------------------------------------------------

fn format_response(status: u16, data: &Value) -> Value {
    match status {
        401 => json!({
            "content": [{ "type": "text", "text": json!({
                "error": "Authentication failed. Check your REVKLIK_TOKEN.",
                "hint": "Generate a new token at https://app.revklik.com/settings/api-tokens"
            }).to_string() }],
            "isError": true
        }),
        403 => json!({
            "content": [{ "type": "text", "text": json!({
                "error": "Permission denied for this operation.",
                "hint": "Your token may not have access to the requested site or scope."
            }).to_string() }],
            "isError": true
        }),
        404 => json!({
            "content": [{ "type": "text", "text": json!({ "error": "Resource not found." }).to_string() }],
            "isError": true
        }),
        s if s >= 500 => json!({
            "content": [{ "type": "text", "text": json!({
                "error": "Server error. Try again later.",
                "status": s
            }).to_string() }],
            "isError": true
        }),
        // Catch-all client error (400/422/…). RevKlik validation failures land
        // here — they must surface as MCP errors, not be pretty-printed as if
        // they succeeded.
        s if s >= 400 => json!({
            "content": [{ "type": "text", "text": json!({
                "error": format!("Request failed (HTTP {}).", s),
                "detail": data
            }).to_string() }],
            "isError": true
        }),
        _ => json!({
            "content": [{ "type": "text", "text": serde_json::to_string_pretty(data).unwrap_or_default() }]
        }),
    }
}

/// Wrap a non-HTTP error into MCP tool response format.
fn error_response(msg: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": json!({ "error": msg }).to_string() }],
        "isError": true
    })
}

/// Wrap a connection error into MCP tool response format.
fn connection_error_response(msg: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": json!({
            "error": "Cannot reach RevKlik API. Check REVKLIK_API_BASE.",
            "detail": msg
        }).to_string() }],
        "isError": true
    })
}

/// Call a handler and catch API/network errors into MCP format.
fn call_handler(
    client: &ApiClient,
    f: impl FnOnce(&ApiClient) -> Result<(u16, Value), String>,
) -> Result<Value, String> {
    match f(client) {
        Ok((status, data)) => Ok(format_response(status, &data)),
        Err(e) => {
            if e.contains("request")
                || e.contains("connect")
                || e.contains("resolve")
                || e.contains("failed")
            {
                Ok(connection_error_response(&e))
            } else {
                Ok(error_response(&e))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Auth / self tool
// ---------------------------------------------------------------------------

fn tool_whoami() -> Tool {
    Tool {
        name: "whoami",
        description: "Show the authenticated user, their plan, and token metadata. Useful to verify credentials before querying analytics. GET /v1/whoami.",
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        handler: |client, _params| {
            call_handler(client, |c| c.get("/v1/whoami", None))
        },
    }
}

// ---------------------------------------------------------------------------
// Sites tools
// ---------------------------------------------------------------------------

fn tool_list_sites() -> Tool {
    Tool {
        name: "list_sites",
        description: "List all sites accessible to the token. Account tokens (rvt_) see owned + team sites; site tokens (rv_) see only their bound site. GET /v1/sites.",
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        handler: |client, _params| {
            call_handler(client, |c| c.get("/v1/sites", None))
        },
    }
}

fn tool_get_site() -> Tool {
    Tool {
        name: "get_site",
        description: "Get details for a single site by ID. GET /v1/sites/:site_id.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "The site ID (required)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            let site_id = params["site_id"].as_str().ok_or("site_id is required")?;
            let path = format!("/v1/sites/{}", site_id);
            call_handler(client, |c| c.get(&path, None))
        },
    }
}

// ---------------------------------------------------------------------------
// Tokens tools
// ---------------------------------------------------------------------------

fn tool_list_tokens() -> Tool {
    Tool {
        name: "list_tokens",
        description: "List all API tokens for the authenticated user. GET /v1/tokens.",
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        handler: |client, _params| call_handler(client, |c| c.get("/v1/tokens", None)),
    }
}

fn tool_create_token() -> Tool {
    Tool {
        name: "create_token",
        description: "Create a new API token. Account tokens (rvt_) get full access; site tokens (rv_) are restricted to one site. POST /v1/tokens.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Token name (required)" },
                "type": { "type": "string", "enum": ["account","site"], "description": "Token type (required)" },
                "site_id": { "type": "string", "description": "Site ID (required for site tokens)" },
                "scopes": { "type": "array", "items": {"type": "string"}, "description": "Comma-separated scopes (optional)" }
            },
            "required": ["name", "type"]
        }),
        handler: |client, params| {
            let mut input = params.clone();
            if let Some(obj) = input.as_object_mut() {
                if let Some(scope_str) = obj.remove("scopes") {
                    if let Some(s) = scope_str.as_str() {
                        obj.insert("scopes".to_string(), json!(s.split(',').map(|x| x.trim()).collect::<Vec<_>>()));
                    }
                }
            }
            call_handler(client, |c| c.post("/v1/tokens", Some(&input)))
        },
    }
}

fn tool_revoke_token() -> Tool {
    Tool {
        name: "revoke_token",
        description: "Revoke (delete) an API token by ID. Cannot revoke session tokens. DELETE /v1/tokens/:id.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Token ID to revoke (required)" }
            },
            "required": ["id"]
        }),
        handler: |client, params| {
            let id = params["id"].as_str().ok_or("id is required")?;
            let path = format!("/v1/tokens/{}", id);
            call_handler(client, |c| c.delete(&path))
        },
    }
}

// ---------------------------------------------------------------------------
// Analytics tools
// ---------------------------------------------------------------------------

fn tool_analytics_overview() -> Tool {
    Tool {
        name: "analytics_overview",
        description: "Analytics overview stats for a site: pageviews, visitors, sessions, bounce rate, conversions, revenue. GET /v1/analytics/overview.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/overview", Some(params)))
        },
    }
}

fn tool_analytics_timeseries() -> Tool {
    Tool {
        name: "analytics_timeseries",
        description: "Time-series data (daily or hourly for 24h): pageviews and visitors per bucket. GET /v1/analytics/timeseries.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/timeseries", Some(params)))
        },
    }
}

fn tool_analytics_pages() -> Tool {
    Tool {
        name: "analytics_pages",
        description: "Top pages by pageviews and visitors. GET /v1/analytics/pages.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" },
                "limit": { "type": "number", "description": "Max results (default 10, max 100)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/pages", Some(params)))
        },
    }
}

fn tool_analytics_referrers() -> Tool {
    Tool {
        name: "analytics_referrers",
        description: "Traffic sources: referrer domain, visitor count, and percentage share. GET /v1/analytics/referrers.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/referrers", Some(params)))
        },
    }
}

fn tool_analytics_geo() -> Tool {
    Tool {
        name: "analytics_geo",
        description:
            "Geographic breakdown: visitors by country, region, and city. GET /v1/analytics/geo.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" },
                "limit": { "type": "number", "description": "Max results (default 50, max 500)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/geo", Some(params)))
        },
    }
}

fn tool_analytics_devices() -> Tool {
    Tool {
        name: "analytics_devices",
        description: "Device breakdown: visitors by device type, OS, and browser, each with percentage share. GET /v1/analytics/devices.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/devices", Some(params)))
        },
    }
}

fn tool_analytics_revenue() -> Tool {
    Tool {
        name: "analytics_revenue",
        description: "Revenue breakdown: by source, by country, and a revenue time series. GET /v1/analytics/revenue.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/revenue", Some(params)))
        },
    }
}

fn tool_analytics_campaigns() -> Tool {
    Tool {
        name: "analytics_campaigns",
        description: "Campaign/channel breakdown: visitors, pageviews, and revenue by UTM source/medium/campaign. GET /v1/analytics/campaigns.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/v1/analytics/campaigns", Some(params)))
        },
    }
}

fn tool_analytics_export() -> Tool {
    Tool {
        name: "analytics_export",
        description: "Raw event log for a site: pageviews, conversions, and custom events with visitor/session context, geo/device info, UTM params, and revenue. GET /v1/analytics/export.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" },
                "type": { "type": "string", "description": "Event type filter (pageview, conversion, custom, or omit for all)" },
                "limit": { "type": "number", "description": "Max events (default 50, max 10000)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            let mut p = params.clone();
            // Default format=json, type=all
            if let Some(obj) = p.as_object_mut() {
                if obj.get("type").is_none() {
                    obj.insert("type".to_string(), json!("events"));
                }
                obj.insert("format".to_string(), json!("json"));
            }
            call_handler(client, |c| c.get("/v1/analytics/export", Some(&p)))
        },
    }
}

// ---------------------------------------------------------------------------
// GSC tools
// ---------------------------------------------------------------------------

fn tool_gsc_queries() -> Tool {
    Tool {
        name: "gsc_queries",
        description: "Google Search Console top search queries (clicks, impressions, CTR, position) aggregated across the stored 30-day window. GET /gsc/queries.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" },
                "range": { "type": "string", "enum": ["24h","7d","30d","90d"], "description": "Date range (default 7d)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.get("/gsc/queries", Some(params)))
        },
    }
}

fn tool_gsc_sync() -> Tool {
    Tool {
        name: "gsc_sync",
        description: "Trigger a Google Search Console sync (pulls last 7 days of search analytics). POST /gsc/sync.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_id": { "type": "string", "description": "Site ID or domain (required)" }
            },
            "required": ["site_id"]
        }),
        handler: |client, params| {
            call_handler(client, |c| c.request("POST", "/gsc/sync", Some(params), None))
        },
    }
}

// ---------------------------------------------------------------------------
// Utility tools
// ---------------------------------------------------------------------------

fn tool_api_call() -> Tool {
    Tool {
        name: "api_call",
        description: "Make a direct API call to any RevKlik REST endpoint. Use this when no dedicated tool covers the operation you need. Provide the full path with prefix (e.g. /v1/analytics/overview or /gsc/queries), HTTP method, and optional params/body.",
        input_schema: json!({
            "type": "object",
            "properties": {
                "method": { "type": "string", "enum": ["GET","POST","PATCH","PUT","DELETE"], "description": "HTTP method (required)" },
                "path": { "type": "string", "description": "Full API path including prefix (e.g. /v1/sites, /gsc/queries)" },
                "params": { "type": "string", "description": "JSON string of query parameters (for GET/DELETE)" },
                "body": { "type": "string", "description": "JSON string of request body (for POST/PATCH/PUT)" }
            },
            "required": ["method", "path"]
        }),
        handler: |client, params| {
            let method = params["method"].as_str().ok_or("method is required")?;
            let path = params["path"].as_str().ok_or("path is required")?;

            let body: Option<Value> = params
                .get("body")
                .and_then(|v| v.as_str())
                .map(serde_json::from_str)
                .transpose()
                .map_err(|e| format!("Invalid body JSON: {}", e))?;

            let query_params: Option<Value> = params
                .get("params")
                .and_then(|v| v.as_str())
                .map(serde_json::from_str)
                .transpose()
                .map_err(|e| format!("Invalid params JSON: {}", e))?;

            call_handler(client, |c| {
                c.request(method, path, query_params.as_ref(), body.as_ref())
            })
        },
    }
}

fn tool_list_available_tools() -> Tool {
    Tool {
        name: "list_available_tools",
        description: "List all available MCP tools with their names and descriptions. Use this to discover what operations you can perform.",
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        handler: |_client, _params| {
            let tools: Vec<Value> = all_tools()
                .iter()
                .map(|t| json!({ "name": t.name, "description": t.description }))
                .collect();
            Ok(json!({
                "content": [{
                    "type": "text",
                    "text": serde_json::to_string_pretty(&json!({ "tools": tools, "total": tools.len() })).unwrap_or_default()
                }]
            }))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;

    fn client() -> ApiClient {
        ApiClient::new("http://127.0.0.1:1", "test-key")
    }

    /// Canonical tool surface — the exact expected set of tool names. Tests
    /// assert all_tools() and list_available_tools both match this set, so a
    /// rename, removal, or unregistered new tool is caught. The count is
    /// derived from this list (no hardcoded magic number). Add a name here
    /// whenever you register a new tool in all_tools().
    const CANONICAL_TOOL_NAMES: &[&str] = &[
        "whoami",
        "list_sites",
        "get_site",
        "list_tokens",
        "create_token",
        "revoke_token",
        "analytics_overview",
        "analytics_timeseries",
        "analytics_pages",
        "analytics_referrers",
        "analytics_geo",
        "analytics_devices",
        "analytics_revenue",
        "analytics_campaigns",
        "analytics_export",
        "gsc_queries",
        "gsc_sync",
        "api_call",
        "list_available_tools",
    ];

    #[test]
    fn all_tools_count_matches_canonical() {
        let tools = all_tools();
        assert_eq!(
            tools.len(),
            CANONICAL_TOOL_NAMES.len(),
            "all_tools() count drifted from CANONICAL_TOOL_NAMES"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name).collect();
        for expected in CANONICAL_TOOL_NAMES {
            assert!(names.contains(expected), "missing tool: {expected}");
        }
        let mut deduped = names.clone();
        deduped.sort_unstable();
        deduped.dedup();
        assert_eq!(
            names.len(),
            deduped.len(),
            "duplicate tool names in all_tools()"
        );
    }

    #[test]
    fn each_tool_has_name_desc_and_object_schema() {
        for t in all_tools() {
            assert!(!t.name.is_empty(), "tool with empty name");
            assert!(
                !t.description.is_empty(),
                "tool `{}` has empty description",
                t.name
            );
            assert!(
                t.input_schema.is_object(),
                "tool `{}` inputSchema is not an object",
                t.name
            );
        }
    }

    #[test]
    fn list_available_tools_advertises_canonical_set() {
        let tools = all_tools();
        let total = tools.len();
        let tool = tools
            .into_iter()
            .find(|t| t.name == "list_available_tools")
            .expect("list_available_tools present");
        let res = (tool.handler)(&client(), &json!({})).expect("handler ok");
        let text = res["content"][0]["text"].as_str().expect("text content");
        let parsed: Value = serde_json::from_str(text).expect("json text");
        // Generated catalogue must report the live registry size.
        assert_eq!(parsed["total"], json!(total));
        let advertised: Vec<&str> = parsed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        // Exact set match — catches both missing and extra (unregistered) tools.
        let mut want: Vec<&str> = CANONICAL_TOOL_NAMES.to_vec();
        let mut got = advertised.clone();
        want.sort_unstable();
        got.sort_unstable();
        assert_eq!(
            got, want,
            "advertised tool set drifted from CANONICAL_TOOL_NAMES"
        );
    }

    #[test]
    fn format_response_401_has_auth_hint() {
        let r = format_response(401, &json!({}));
        assert!(r["isError"] == true);
        let text = r["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Authentication failed"));
    }

    #[test]
    fn format_response_200_pretty_prints_data() {
        let r = format_response(200, &json!({ "visitors": 42 }));
        assert!(r["isError"].is_null() || r["isError"] != true);
        let text = r["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("visitors"));
    }
}

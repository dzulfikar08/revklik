use crate::api::ApiClient;
use crate::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use crate::tools::Tool;
use serde_json::{json, Value};

pub fn handle_request(
    request: JsonRpcRequest,
    tools: &[Tool],
    client: &ApiClient,
) -> JsonRpcResponse {
    match request.method.as_str() {
        "initialize" => handle_initialize(request),
        "notifications/initialized" => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: None,
            result: None,
            error: None,
        },
        "tools/list" => handle_tools_list(request, tools),
        "tools/call" => handle_tools_call(request, tools, client),
        "ping" => JsonRpcResponse::success(request.id, json!({})),
        _ => JsonRpcResponse::error(
            request.id,
            -32601,
            format!("Method not found: {}", request.method),
        ),
    }
}

/// MCP protocol versions this server can speak, oldest → newest.
pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] =
    &["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

/// Newest protocol version this server implements.
pub const LATEST_PROTOCOL_VERSION: &str = "2025-11-25";

/// Echo the client's requested version when we support it; otherwise fall back to
/// the newest version we implement. Per the MCP spec the server picks the version
/// actually in effect for the session.
pub fn negotiate_protocol(client_version: Option<&Value>) -> &'static str {
    if let Some(Value::String(v)) = client_version {
        if let Some(&matched) = SUPPORTED_PROTOCOL_VERSIONS
            .iter()
            .find(|&&sv| sv == v.as_str())
        {
            return matched;
        }
    }
    LATEST_PROTOCOL_VERSION
}

fn handle_initialize(request: JsonRpcRequest) -> JsonRpcResponse {
    let client_version = request
        .params
        .as_ref()
        .and_then(|p| p.get("protocolVersion"));
    let result = json!({
        "protocolVersion": negotiate_protocol(client_version),
        "capabilities": {
            "tools": { "listChanged": true }
        },
        "serverInfo": {
            "name": "revklik",
            "version": "0.1.0"
        }
    });
    JsonRpcResponse::success(request.id, result)
}

fn handle_tools_list(request: JsonRpcRequest, tools: &[Tool]) -> JsonRpcResponse {
    let tool_list: Vec<Value> = tools
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.input_schema
            })
        })
        .collect();

    let result = json!({ "tools": tool_list });
    JsonRpcResponse::success(request.id, result)
}

fn handle_tools_call(
    request: JsonRpcRequest,
    tools: &[Tool],
    client: &ApiClient,
) -> JsonRpcResponse {
    let params = request.params.unwrap_or(json!({}));

    let tool_name = params["name"].as_str().unwrap_or("");

    let tool = match tools.iter().find(|t| t.name == tool_name) {
        Some(t) => t,
        None => {
            return JsonRpcResponse::error(
                request.id,
                -32602,
                format!("Unknown tool: {}", tool_name),
            );
        }
    };

    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    match (tool.handler)(client, &arguments) {
        Ok(result) => JsonRpcResponse::success(request.id, result),
        Err(e) => {
            let error_val = if e.contains("request")
                || e.contains("connect")
                || e.contains("resolve")
                || e.contains("failed")
            {
                json!({
                    "content": [{ "type": "text", "text": json!({
                        "error": "Cannot reach RevKlik API. Check REVKLIK_API_BASE.",
                        "detail": e
                    }).to_string() }],
                    "isError": true
                })
            } else {
                json!({
                    "content": [{ "type": "text", "text": json!({ "error": e }).to_string() }],
                    "isError": true
                })
            };
            JsonRpcResponse::success(request.id, error_val)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::tools::all_tools;
    use serde_json::json;

    fn client() -> ApiClient {
        ApiClient::new("http://127.0.0.1:1", "test-key")
    }

    fn req(method: &str, params: Option<Value>) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: method.to_string(),
            params,
        }
    }

    #[test]
    fn negotiate_defaults_to_latest_when_unsupported() {
        assert_eq!(negotiate_protocol(None), LATEST_PROTOCOL_VERSION);
        assert_eq!(
            negotiate_protocol(Some(&json!("9999-99-99"))),
            LATEST_PROTOCOL_VERSION
        );
    }

    #[test]
    fn negotiate_echoes_supported_client_version() {
        assert_eq!(negotiate_protocol(Some(&json!("2024-11-05"))), "2024-11-05");
        assert_eq!(negotiate_protocol(Some(&json!("2025-11-25"))), "2025-11-25");
    }

    #[test]
    fn initialize_advertises_latest_protocol_and_server_info() {
        let tools = all_tools();
        let resp = handle_request(req("initialize", None), &tools, &client());
        let result = resp.result.expect("initialize result");
        assert_eq!(result["protocolVersion"], json!(LATEST_PROTOCOL_VERSION));
        assert_eq!(result["serverInfo"]["name"], json!("revklik"));
        assert_eq!(result["capabilities"]["tools"]["listChanged"], json!(true));
    }

    #[test]
    fn initialize_echoes_client_protocol_when_supported() {
        let tools = all_tools();
        let params = Some(json!({"protocolVersion": "2024-11-05"}));
        let resp = handle_request(req("initialize", params), &tools, &client());
        assert_eq!(resp.result.unwrap()["protocolVersion"], json!("2024-11-05"));
    }

    #[test]
    fn tools_list_returns_all_well_formed_tools() {
        let tools = all_tools();
        let resp = handle_request(req("tools/list", None), &tools, &client());
        let list = resp.result.unwrap()["tools"].as_array().unwrap().clone();
        assert_eq!(list.len(), tools.len());
        let names: Vec<String> = list
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        let mut deduped = names.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(names.len(), deduped.len(), "duplicate tool names exposed");
        for t in &list {
            assert!(!t["name"].as_str().unwrap().is_empty());
            assert!(t["description"].is_string());
            assert!(t["inputSchema"].is_object());
        }
    }

    #[test]
    fn unknown_method_returns_jsonrpc_32601() {
        let tools = all_tools();
        let resp = handle_request(req("bogus/method", None), &tools, &client());
        assert_eq!(resp.error.expect("error").code, -32601);
    }

    #[test]
    fn ping_replies_with_empty_result() {
        let tools = all_tools();
        let resp = handle_request(req("ping", None), &tools, &client());
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn unknown_tool_call_returns_32602() {
        let tools = all_tools();
        let params = Some(json!({"name": "no_such_tool", "arguments": {}}));
        let resp = handle_request(req("tools/call", params), &tools, &client());
        assert_eq!(resp.error.expect("error").code, -32602);
    }

    #[test]
    fn call_list_available_tools_reports_live_total() {
        let tools = all_tools();
        let total = tools.len();
        let params = Some(json!({"name": "list_available_tools", "arguments": {}}));
        let resp = handle_request(req("tools/call", params), &tools, &client());
        let content = resp.result.unwrap();
        let text = content["content"][0]["text"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["total"], json!(total));
        assert_eq!(parsed["tools"].as_array().unwrap().len(), total);
    }

    #[test]
    fn notifications_initialized_silently_acknowledged() {
        let tools = all_tools();
        let resp = handle_request(req("notifications/initialized", None), &tools, &client());
        assert!(resp.result.is_none());
        assert!(resp.error.is_none());
    }
}

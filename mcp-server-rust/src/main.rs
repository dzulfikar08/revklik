mod api;
mod jsonrpc;
mod server;
mod tools;

use std::io::{self, BufRead, Write};

fn main() {
    let api_client = match api::ApiClient::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("RevKlik MCP Server error: {}", e);
            std::process::exit(1);
        }
    };

    let tools = tools::all_tools();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<jsonrpc::JsonRpcRequest>(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Failed to parse JSON-RPC request: {}", e);
                continue;
            }
        };

        let response = server::handle_request(request, &tools, &api_client);

        // Don't respond to notifications (no id)
        if response.id.is_some() {
            match serde_json::to_string(&response) {
                Ok(json_str) => {
                    if stdout_lock.write_all(json_str.as_bytes()).is_err() {
                        break;
                    }
                    if stdout_lock.write_all(b"\n").is_err() {
                        break;
                    }
                    if stdout_lock.flush().is_err() {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("Failed to serialize response: {}", e);
                }
            }
        }
    }
}

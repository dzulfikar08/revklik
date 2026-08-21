# revklik-mcp

A Rust MCP (Model Context Protocol) server that lets an **external** AI harness — Claude Desktop, Cursor, Cline, a Telegram bot, or any MCP-speaking client — query RevKlik analytics the same way a human does: look up site stats, pull traffic breakdowns, search referrers/geo/devices, check GSC data, manage sites and API tokens, and export raw events.

The server speaks JSON-RPC 2.0 over stdio (the MCP standard transport) and proxies tool calls to the RevKlik REST API (`https://app.revklik.com/api/v1/...`). Auth is a single RevKlik API token (`rvt_...` account token or `rv_...` site token) sent as a Bearer token.

## Prerequisites

- A RevKlik account with API access. Generate a token from **Settings → API Tokens** in the web UI. The token carries the user's permissions — every MCP tool is gated by the same auth checks as the web app.
- A Rust toolchain (rustc 1.70+, with `rustfmt` and `clippy`).

## Required environment

| Variable          | Required | Example                              | Notes |
|-------------------|----------|--------------------------------------|-------|
| `REVKLIK_API_BASE` | yes      | `https://app.revklik.com/api`        | Base URL of the RevKlik API. No trailing `/`. Includes the `/api` prefix. |
| `REVKLIK_TOKEN`    | yes      | `rvt_abc123...`                      | API token from Settings → API Tokens. Auth is `Authorization: Bearer <token>`. Use an account token (`rvt_`) for full access, or a site token (`rv_`) for scoped access. |

## Build

```bash
# from the revklik-app repo root
bun run mcp:rust:build
# binary lands at mcp-server-rust/target/debug/revklik-mcp

# or standalone:
cd mcp-server-rust
cargo build --release
# binary at target/release/revklik-mcp
```

## MCP stdio config

Every harness ultimately spawns the server as a child process with these env vars set and talks JSON-RPC over its stdin/stdout:

```json
{
  "mcpServers": {
    "revklik": {
      "command": "/absolute/path/to/revklik-app/mcp-server-rust/target/release/revklik-mcp",
      "env": {
        "REVKLIK_API_BASE": "https://app.revklik.com/api",
        "REVKLIK_TOKEN": "rvt_abc123..."
      }
    }
  }
}
```

Use the **absolute** path to the binary — most harnesses do not resolve `$PATH` for the spawned command.

### Claude Desktop

Edit (or create) `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Cursor

Create `.cursor/mcp.json` in the project root (per-project) or in `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "revklik": {
      "command": "/absolute/path/to/revklik-mcp",
      "env": {
        "REVKLIK_API_BASE": "https://app.revklik.com/api",
        "REVKLIK_TOKEN": "rvt_abc123..."
      }
    }
  }
}
```

### Cline / Roo Code / VS Code

Same `mcpServers` shape — these follow the de-facto convention. In VS Code's MCP settings UI or `~/.cline/mcp_settings.json`.

## Tool surface (19 tools)

### Auth & sites
| Tool | Description |
|---|---|
| `whoami` | Authenticated user, plan, and token metadata |
| `list_sites` | List all sites (account token) or the bound site (site token) |
| `get_site` | Get a single site's details by ID |

### API tokens
| Tool | Description |
|---|---|
| `list_tokens` | List all API tokens for the authenticated user |
| `create_token` | Create a new account or site API token |
| `revoke_token` | Revoke (delete) an API token by ID |

### Analytics
| Tool | Description |
|---|---|
| `analytics_overview` | Pageviews, visitors, sessions, bounce rate, conversions, revenue |
| `analytics_timeseries` | Daily (or hourly for 24h) pageview/visitor counts |
| `analytics_pages` | Top pages by pageviews and visitors |
| `analytics_referrers` | Traffic sources with visitor count and percentage |
| `analytics_geo` | Visitors by country, region, city |
| `analytics_devices` | Device, OS, and browser breakdowns |
| `analytics_revenue` | Revenue by source, by country, and time series |
| `analytics_campaigns` | UTM source/medium/campaign channel breakdown |
| `analytics_export` | Raw event log with full visitor/session/geo/device/UTM context |

### Google Search Console
| Tool | Description |
|---|---|
| `gsc_queries` | Top search queries with clicks, impressions, CTR, position |
| `gsc_sync` | Trigger a GSC data sync (last 7 days) |

### Escape hatches
| Tool | Description |
|---|---|
| `api_call` | Make any REST call to any RevKlik endpoint — useful when no dedicated tool covers the need |
| `list_available_tools` | Self-describing: returns the live tool catalogue (generated from `all_tools()`) |

## How the AI agent picks tools

The model can chain calls. Typical phrasings and the tool they resolve to:

| User intent | Tool | Args |
|---|---|---|
| "what are my sites?" | `list_sites` | `{}` |
| "show me site abc123's traffic" | `analytics_overview` | `{"site_id":"abc123"}` |
| "top pages last 30 days" | `analytics_pages` | `{"site_id":"abc123","range":"30d"}` |
| "where are my visitors from?" | `analytics_geo` | `{"site_id":"abc123"}` |
| "device breakdown" | `analytics_devices` | `{"site_id":"abc123"}` |
| "revenue this week" | `analytics_revenue` | `{"site_id":"abc123","range":"7d"}` |
| "search console queries" | `gsc_queries` | `{"site_id":"abc123"}` |
| "create a token for my client" | `create_token` | `{"name":"client","type":"account"}` |
| "export raw events" | `analytics_export` | `{"site_id":"abc123","range":"7d","limit":100}` |

The model can resolve a domain to a site ID via `list_sites`, then feed it into analytics calls.

## Verifying the connection

```bash
# 1. build
bun run mcp:rust:build

# 2. smoke test (offline — no real RevKlik needed; asserts the wire contract)
bun run mcp:rust:check
# → rustfmt + clippy + tests + smoke.sh + drift-check, all green

# 3. live ping against your tenant
REVKLIK_API_BASE=https://app.revklik.com/api \
REVKLIK_TOKEN=rvt_... \
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' | \
  ./mcp-server-rust/target/debug/revklik-mcp
```

## Troubleshooting

- **401 from every call**: bad/expired `REVKLIK_TOKEN`. Mint a new one in Settings → API Tokens.
- **403 on a specific tool**: the token's user is missing access to the requested site or scope. Account tokens (`rvt_`) get full access; site tokens (`rv_`) are restricted to their bound site.
- **Cannot reach RevKlik API**: wrong `REVKLIK_API_BASE`. The URL must include `/api` (e.g. `https://app.revklik.com/api`), no trailing `/`.
- **GSC queries return empty or fail**: GSC must be connected in the RevKlik web app first. Run `gsc_sync` to pull fresh data, then `gsc_queries`.

## Development

- `cargo test` — unit tests (canonical tool count, schema well-formedness, JSON-RPC contract, envelope unwrapping, URL building).
- `mcp-server-rust/tests/smoke.sh` — end-to-end stdio probe (no real API needed).
- `mcp-server-rust/tests/drift-check.sh` — static guard: every API endpoint path referenced by `tools.rs` must be a defined route in `server-rs/src/routes/v1/mod.rs` or `server-rs/src/routes/mod.rs`. Catches the rot that killed the original CLI — tools advertising endpoints that no longer exist.
- `bun run mcp:rust:check` — all of the above in one command.

When adding a new tool: register it in `all_tools()`, add its name to `CANONICAL_TOOL_NAMES` in `src/tools.rs`, and add it to the `CANONICAL_TOOL_NAMES` list in `tests/smoke_probe.py`. The unit tests and the smoke probe assert the registry matches that list exactly — a renamed or unregistered tool fails CI.

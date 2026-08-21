#!/usr/bin/env bash
# End-to-end smoke test for the revklik-mcp Rust MCP server.
#
# Builds the debug binary, then drives it over stdio JSON-RPC (initialize,
# tools/list, tools/call, ping, error + unreachable-API paths). No real
# RevKlik API required — the only network call targets 127.0.0.1:1 on purpose.
#
# Run:
#   bash mcp-server-rust/tests/smoke.sh
# Or via the repo root:  bun run mcp:rust:check
#
# Exits 0 on pass, 1 on any fail.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/target/debug/revklik-mcp"

cd "$ROOT"

echo "== building revklik-mcp (debug) =="
cargo build --quiet

if [ ! -x "$BIN" ]; then
  echo "  [-] binary not found at $BIN"
  exit 1
fi

echo "== smoke probe over stdio JSON-RPC =="
# Point at an unreachable API on purpose so we can assert the error envelope,
# not because we expect it to work.
REVKLIK_API_BASE="http://127.0.0.1:1/api" \
REVKLIK_TOKEN="rvt_smoke-test-key" \
  python3 "$ROOT/tests/smoke_probe.py" "$BIN"

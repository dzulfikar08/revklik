#!/usr/bin/env bash
# Drift guard: every API endpoint path referenced by the MCP tools must still be a
# defined route in the RevKlik server's route files.
#
# This catches the same failure mode that rotted OpexMX's original TS MCP server:
# curated tools whose backing endpoints had been removed, renamed, or migrated —
# and silently 404'd in production. The unit tests can't see this because they
# never hit a live API; this check does, statically, by diffing the tool
# surface against the real route definitions.
#
# Run:  bash mcp-server-rust/tests/drift-check.sh
# (also invoked by `bun run mcp:rust:check`)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS="$ROOT/mcp-server-rust/src/tools.rs"
V1_ROUTES="$ROOT/server-rs/src/routes/v1/mod.rs"
MAIN_ROUTES="$ROOT/server-rs/src/routes/mod.rs"

for f in "$TOOLS" "$V1_ROUTES" "$MAIN_ROUTES"; do
  [ -f "$f" ] || { echo "  [-] missing $f" >&2; exit 1; }
done

echo "drift-check: verifying MCP tool endpoints against server route definitions"
python3 "$ROOT/mcp-server-rust/tests/route_drift_check.py" \
  "$TOOLS" "$V1_ROUTES" "$MAIN_ROUTES"

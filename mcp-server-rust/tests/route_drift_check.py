#!/usr/bin/env python3
"""
Route-level drift guard for the RevKlik MCP server.

Every API endpoint path a curated MCP tool calls must still be a defined route
in the RevKlik server. This catches the same rot that killed OpexMX's original
TS MCP server: tools whose backing endpoints had been removed, renamed, or
migrated, silently 404'ing in production.

Two layers of checking:
  1. Path existence — every tool path (literal or format-string template) maps
     to a server route.
  2. Method match — for direct calls (c.get/c.post/...), the HTTP verb matches
     what the server route accepts.

Run:  python3 mcp-server-rust/tests/route_drift_check.py <tools.rs> <v1/mod.rs> <routes/mod.rs>
(also invoked by `bash mcp-server-rust/tests/drift-check.sh`)
"""
import re
import sys
from pathlib import Path


def die(msg: str) -> None:
    print(f"  [-] {msg}", file=sys.stderr)


def normalize_path(path: str) -> str:
    """Normalize a path for comparison: replace param segments with :param."""
    return re.sub(r":\w+", ":param", path)


def parse_server_routes(v1_file: Path, main_file: Path) -> dict[str, set[str]]:
    """Return {normalized_path: set(http_methods)} from the server route files."""
    routes: dict[str, set[str]] = {}

    # v1/mod.rs — paths are relative to /api/v1, e.g. .route("/analytics/overview", get(...))
    for line in v1_file.read_text().splitlines():
        m = re.search(r'\.route\("(/[^"]+)"\s*,\s*(.+)\)', line)
        if not m:
            continue
        path = m.group(1)
        methods = extract_methods(m.group(2))
        if methods:
            routes[normalize_path(path)] = routes.get(normalize_path(path), set()) | methods

    # routes/mod.rs — GSC routes are absolute, e.g. .route("/api/gsc/queries", get(...))
    for line in main_file.read_text().splitlines():
        m = re.search(r'\.route\("(/api/gsc/[^"]+)"\s*,\s*(.+)\)', line)
        if not m:
            continue
        path = m.group(1)
        # Normalize: strip /api prefix so it matches MCP tool paths (/gsc/...)
        normalized = path[len("/api"):] if path.startswith("/api") else path
        methods = extract_methods(m.group(2))
        if methods:
            routes[normalize_path(normalized)] = routes.get(normalize_path(normalized), set()) | methods

    return routes


def extract_methods(rest: str) -> set[str]:
    """Extract HTTP method names from the handler part of a .route() call."""
    methods = set()
    for verb in ("get", "post", "patch", "put", "delete"):
        if re.search(rf'\b{verb}\(', rest):
            methods.add(verb.upper())
    return methods


def parse_tool_endpoints(tools_src: str) -> list[tuple[str, str, str]]:
    """Extract (method, raw_path, source_label) from tools.rs.

    Handles:
      - Direct calls: c.get("/v1/sites", None)  → captures method + literal path
      - Format strings: format!("/v1/sites/{}", site_id) → path only, method inferred
    """
    endpoints = []

    # Direct method calls with a literal path: c.get("/v1/...", ...)
    for m in re.finditer(r'c\.(get|post|put|patch|delete)\("((?:/v1|/gsc)/[^"]*)"', tools_src):
        method = m.group(1).upper()
        raw_path = m.group(2)
        endpoints.append((method, raw_path, "direct"))

    # Parameterized paths via format!: format!("/v1/sites/{}", site_id)
    # We can't infer the HTTP method from the variable, so use GET as a hint
    # and only check path existence (not method) for these.
    for m in re.finditer(r'format!\("((?:/v1)/[^"]*)"', tools_src):
        raw_path = m.group(1)  # e.g. "/v1/sites/{}"
        endpoints.append(("GET", raw_path, "format"))

    return endpoints


def normalize_tool_path(raw_path: str) -> str:
    """Convert MCP tool paths to the same form used by server routes.

    - Strip /v1/ prefix (server v1 routes are defined relative to /api/v1)
    - Replace {} format placeholder → :param wildcard
    - /gsc/... paths stay as-is (already relative to /api)
    """
    if raw_path.startswith("/v1/"):
        path = raw_path[3:]  # "/v1/sites" → "/sites"
    else:
        path = raw_path
    # Replace {} with :param for parameterized paths
    path = path.replace("{}", ":param")
    return path


def main() -> int:
    if len(sys.argv) != 4:
        die("usage: route_drift_check.py <tools.rs> <v1/mod.rs> <routes/mod.rs>")
        return 1

    tools_file = Path(sys.argv[1])
    v1_file = Path(sys.argv[2])
    main_file = Path(sys.argv[3])

    for f in (tools_file, v1_file, main_file):
        if not f.is_file():
            die(f"missing {f}")
            return 1

    server_routes = parse_server_routes(v1_file, main_file)
    tools_src = tools_file.read_text()
    tool_endpoints = parse_tool_endpoints(tools_src)

    errors = []
    all_server_paths = set(server_routes.keys())

    for method, raw_path, kind in tool_endpoints:
        tool_path = normalize_tool_path(raw_path)

        if tool_path not in server_routes:
            errors.append(
                f"tool endpoint path '{tool_path}' (from raw '{raw_path}', kind={kind}) "
                f"is not defined in server routes"
            )
        elif kind == "direct" and method not in server_routes[tool_path]:
            supported = sorted(server_routes[tool_path])
            errors.append(
                f"tool endpoint {method} {tool_path} — server route only supports {supported}"
            )

    if errors:
        print("route-drift: MCP tool endpoints missing or mismatched in server routes:",
              file=sys.stderr)
        for e in errors:
            print(f"  [-] {e}", file=sys.stderr)
        print("  fix: repoint the tool to the correct path/method, or update the server route.",
              file=sys.stderr)
        return 1

    tool_n = len(tool_endpoints)
    route_n = len(all_server_paths)
    print(f"route-drift: {tool_n} tool endpoints, {route_n} server routes, all present with matching methods")
    return 0


if __name__ == "__main__":
    sys.exit(main())

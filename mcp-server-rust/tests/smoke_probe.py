#!/usr/bin/env python3
"""
End-to-end smoke probe for the revklik-mcp Rust MCP server.

Spawns the built binary, speaks JSON-RPC over stdio, and asserts the wire
contract that real MCP clients (Claude Desktop, Cursor, etc.) depend on.

No real RevKlik API needed:
  - initialize / tools/list / list_available_tools / ping / unknown-tool paths
    never touch the network.
  - The one network-touching call (list_sites) is pointed at an unreachable
    URL (127.0.0.1:1) on purpose — it asserts the server returns a graceful
    MCP error envelope instead of crashing.

Exits 0 on success, 1 on any failure. Run via tests/smoke.sh.

Usage:
  python3 tests/smoke_probe.py /path/to/revklik-mcp
"""

import json
import os
import select
import subprocess
import sys

CANONICAL_TOOL_NAMES = [
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
]
LATEST_PROTOCOL = "2025-11-25"

PASS = 0
FAIL = 0


def ok(msg):
    global PASS
    print(f"  [+] {msg}")
    PASS += 1


def fail(msg):
    global FAIL
    print(f"  [-] {msg}")
    FAIL += 1


def send(proc, obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def recv(proc, want_id, timeout=15):
    """Read stdout lines until the JSON-RPC response with `want_id` arrives."""
    while True:
        ready, _, _ = select.select([proc.stdout], [], [], timeout)
        if not ready:
            return {"_err": f"timeout waiting for id={want_id}"}
        line = proc.stdout.readline()
        if line == "":
            return {"_err": f"server closed stdout waiting for id={want_id}"}
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue  # log line on stdout
        if obj.get("id") == want_id:
            return obj


def call(proc, name, arguments, _id):
    """tools/call helper. Returns the MCP content envelope (result)."""
    send(proc, {"jsonrpc": "2.0", "id": _id, "method": "tools/call",
                 "params": {"name": name, "arguments": arguments}})
    return recv(proc, _id)


def main():
    bin_path = sys.argv[1]
    proc = subprocess.Popen(
        [bin_path],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env={**os.environ},
    )
    try:
        # 1. initialize — latest protocol
        send(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": LATEST_PROTOCOL,
                               "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}}})
        init = recv(proc, 1)
        pv = init.get("result", {}).get("protocolVersion")
        if pv == LATEST_PROTOCOL:
            ok(f"initialize → protocolVersion {pv}")
        else:
            fail(f"initialize protocolVersion: want {LATEST_PROTOCOL}, got {pv!r} ({init.get('_err') or init.get('error')})")

        send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})  # no response expected

        # 2. initialize — negotiation echoes older supported version
        send(proc, {"jsonrpc": "2.0", "id": 2, "method": "initialize",
                    "params": {"protocolVersion": "2024-11-05"}})
        init2 = recv(proc, 2)
        pv2 = init2.get("result", {}).get("protocolVersion")
        if pv2 == "2024-11-05":
            ok(f"negotiation echoes supported client version ({pv2})")
        else:
            fail(f"negotiation: want 2024-11-05 echoed, got {pv2!r}")

        # 3. tools/list — canonical tools
        send(proc, {"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
        tl = recv(proc, 3)
        tools = tl.get("result", {}).get("tools", [])
        names = {t.get("name") for t in tools}
        missing = [n for n in CANONICAL_TOOL_NAMES if n not in names]
        if len(tools) == len(CANONICAL_TOOL_NAMES) and not missing:
            ok(f"tools/list → {len(tools)} tools, all canonical present")
        else:
            fail(f"tools/list: {len(tools)} tools, expected {len(CANONICAL_TOOL_NAMES)}, missing={missing}")

        # 4. tools/call list_available_tools → total matches canonical registry
        r = call(proc, "list_available_tools", {}, 4)
        try:
            text = r["result"]["content"][0]["text"]
            parsed = json.loads(text)
            want = len(CANONICAL_TOOL_NAMES)
            if parsed.get("total") == want and len(parsed.get("tools", [])) == want:
                ok(f"call list_available_tools → total {want}")
            else:
                fail(f"list_available_tools payload: total={parsed.get('total')} want {want}")
        except Exception as e:
            fail(f"list_available_tools parse failed: {e} ({r.get('_err') or r.get('error')})")

        # 5. tools/call unknown tool → JSON-RPC error -32602
        r = call(proc, "no_such_tool", {}, 5)
        code = r.get("error", {}).get("code")
        if code == -32602:
            ok("call unknown tool → error -32602")
        else:
            fail(f"unknown tool: want error -32602, got {r}")

        # 6. ping → empty result
        send(proc, {"jsonrpc": "2.0", "id": 6, "method": "ping"})
        pr = recv(proc, 6)
        if "result" in pr and "error" not in pr:
            ok("ping → result")
        else:
            fail(f"ping: {pr}")

        # 7. list_sites against unreachable API → graceful isError envelope, no crash
        r = call(proc, "list_sites", {}, 7)
        try:
            is_err = r["result"].get("isError") is True
            txt = r["result"]["content"][0]["text"]
            graceful = "Cannot reach RevKlik API" in txt or "Authentication" in txt
            if is_err and graceful:
                ok("list_sites on unreachable API → graceful isError envelope")
            else:
                fail(f"list_sites expected graceful error, got: {txt[:120]}")
        except Exception as e:
            fail(f"list_sites error path malformed: {e} ({r.get('_err') or r.get('error')})")

    finally:
        try:
            proc.stdin.close()
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

    print(f"\nsmoke: pass={PASS} fail={FAIL}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

/**
 * MCP server over the Streamable HTTP transport, mounted at /api/mcp.
 * Stateless: every POST carries a Bearer rvt_/rv_ API token (same tokens
 * as /api/v1); no sessions, no server→client stream (GET+SSE → 405).
 *
 * Rate limiting note: the limiter bucket is keyed by token prefix and is
 * shared with /api/v1 — one per-token quota across both surfaces, by design.
 */
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { publicAuthMiddleware, type PublicApiEnv } from "../../middleware/public-auth";
import { rateLimiterMiddleware } from "../../middleware/rate-limiter";
import { publicApiCtx } from "../../lib/public-api-queries";
import {
	handleRpcMessage,
	isSupportedProtocolVersion,
	parseJsonRpcBody,
	rpcError,
	SERVER_INFO,
} from "./jsonrpc";
import { callTool } from "./handlers";
import { publicToolDef, TOOL_DEFS } from "./tools";

export const mcpRoutes = new Hono<PublicApiEnv>({ strict: false });

mcpRoutes.get("/", (c) => {
	// The MCP Streamable HTTP transport probes GET with Accept: text/event-stream
	// to open a server→client stream. We are stateless (no streaming), so respond
	// 405 — the client then falls back to plain POST request/response. Returning
	// 200 JSON here violates the spec and breaks the SDK handshake.
	const accept = c.req.header("Accept") || "";
	if (accept.includes("text/event-stream")) {
		return c.body(null, 405);
	}
	return c.json({
		name: SERVER_INFO.name,
		version: SERVER_INFO.version,
		description: "RevKlik MCP Server — web analytics",
		protocolVersion: "2025-06-18",
	});
});

// Stateless server: no session lifecycle to terminate.
mcpRoutes.delete("/", (c) => c.body(null, 405));

mcpRoutes.post("/", publicAuthMiddleware, rateLimiterMiddleware, async (c) => {
	const headerVersion = c.req.header("MCP-Protocol-Version");
	if (headerVersion && !isSupportedProtocolVersion(headerVersion)) {
		return c.json(
			rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${headerVersion}`),
			400,
		);
	}

	const parsed = parseJsonRpcBody(await c.req.text());
	if (!parsed.ok) {
		return c.json(parsed.response, 400);
	}

	const ctx = publicApiCtx(c);
	const result = await handleRpcMessage(parsed.msg, {
		listTools: () => TOOL_DEFS.map(publicToolDef),
		callTool: (name, args) => callTool(ctx, name, args),
	});

	const status = result.status as ContentfulStatusCode;
	if (result.body === null) {
		return c.body(null, status);
	}
	return c.json(result.body, status);
});

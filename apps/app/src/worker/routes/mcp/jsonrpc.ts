/**
 * Minimal stateless JSON-RPC 2.0 layer for the MCP Streamable HTTP
 * transport. Hand-rolled (no @modelcontextprotocol/sdk) after the atur
 * MCP route precedent. Pure module — no Hono/D1 imports.
 *
 * Stateless: no sessions, no mcp-session-id, no server→client stream.
 * GET with `Accept: text/event-stream` must be answered 405 by the route.
 */

export const LATEST_PROTOCOL_VERSION = "2025-06-18";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export function isSupportedProtocolVersion(version: string): boolean {
	return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Echo the client's version when known, else fall back to the latest. */
export function negotiateProtocolVersion(requested: unknown): string {
	return typeof requested === "string" && isSupportedProtocolVersion(requested)
		? requested
		: LATEST_PROTOCOL_VERSION;
}

export interface JsonRpcRequest {
	jsonrpc: string;
	id: number | string | null;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: string;
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string };
}

export function rpcOk(id: number | string | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

export function rpcError(
	id: number | string | null,
	code: number,
	message: string,
): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

export type ParsedRpcBody =
	| { ok: true; msg: JsonRpcRequest }
	| { ok: false; response: JsonRpcResponse };

export function parseJsonRpcBody(raw: string): ParsedRpcBody {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, response: rpcError(null, -32700, "Parse error") };
	}
	if (Array.isArray(parsed)) {
		return { ok: false, response: rpcError(null, -32600, "Batch requests are not supported") };
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		(parsed as JsonRpcRequest).jsonrpc !== "2.0" ||
		typeof (parsed as JsonRpcRequest).method !== "string"
	) {
		return { ok: false, response: rpcError(null, -32600, "Invalid Request") };
	}
	return { ok: true, msg: parsed as JsonRpcRequest };
}

export interface ToolCallOutcome {
	ok: boolean;
	data?: unknown;
	error?: string;
	hint?: string;
	/** When set (only -32602 today), fail as a JSON-RPC error instead of an isError result. */
	code?: -32602;
}

export interface RpcDeps {
	listTools(): unknown[];
	callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
}

export interface RpcResult {
	status: number;
	body: JsonRpcResponse | null;
}

export const SERVER_INFO = { name: "revklik-mcp", version: "0.1.0" };

export async function handleRpcMessage(msg: JsonRpcRequest, deps: RpcDeps): Promise<RpcResult> {
	// Client-to-server notifications get no response body.
	if (msg.method.startsWith("notifications/")) {
		return { status: 202, body: null };
	}

	switch (msg.method) {
		case "initialize": {
			return {
				status: 200,
				body: rpcOk(msg.id, {
					protocolVersion: negotiateProtocolVersion(msg.params?.protocolVersion),
					capabilities: { tools: {} },
					serverInfo: SERVER_INFO,
				}),
			};
		}
		case "ping": {
			return { status: 200, body: rpcOk(msg.id, {}) };
		}
		case "tools/list": {
			// MCP spec: result is { tools: [...] } directly, NOT content-wrapped.
			return { status: 200, body: rpcOk(msg.id, { tools: deps.listTools() }) };
		}
		case "tools/call": {
			const params = msg.params as
				| { name?: string; arguments?: Record<string, unknown> }
				| undefined;
			if (!params?.name || typeof params.name !== "string") {
				return { status: 200, body: rpcError(msg.id, -32602, "Missing tool name") };
			}
			const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
			let outcome: ToolCallOutcome;
			try {
				outcome = await deps.callTool(params.name, args);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Internal error";
				return { status: 200, body: rpcError(msg.id, -32603, message) };
			}
			if (!outcome.ok) {
				if (outcome.code === -32602) {
					return { status: 200, body: rpcError(msg.id, -32602, outcome.error ?? "Invalid params") };
				}
				return {
					status: 200,
					body: rpcOk(msg.id, {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: outcome.error, hint: outcome.hint }, null, 2),
							},
						],
						isError: true,
					}),
				};
			}
			// String results (e.g. CSV) pass through verbatim; everything else
			// is pretty-printed JSON.
			const text =
				typeof outcome.data === "string"
					? outcome.data
					: JSON.stringify(outcome.data ?? null, null, 2);
			return {
				status: 200,
				body: rpcOk(msg.id, { content: [{ type: "text", text }] }),
			};
		}
		default:
			return { status: 404, body: rpcError(msg.id, -32601, `Method not found: ${msg.method}`) };
	}
}

import { describe, expect, test } from "bun:test";
import {
	handleRpcMessage,
	LATEST_PROTOCOL_VERSION,
	negotiateProtocolVersion,
	parseJsonRpcBody,
	rpcOk,
	type JsonRpcRequest,
	type RpcDeps,
} from "./jsonrpc";

const msg = (
	method: string,
	params?: Record<string, unknown>,
	id: number | string | null = 1,
): JsonRpcRequest => ({
	jsonrpc: "2.0",
	id,
	method,
	params,
});

const deps: RpcDeps = {
	listTools: () => [{ name: "whoami", description: "d", inputSchema: {} }],
	callTool: async (name, args) =>
		name === "boom"
			? { ok: false, error: "nope", hint: "try again" }
			: name === "throw"
				? (async () => {
						throw new Error("kaboom");
					})()
				: { ok: true, data: { echoed: args } },
};

describe("negotiateProtocolVersion", () => {
	test("echoes known versions", () => {
		expect(negotiateProtocolVersion("2024-11-05")).toBe("2024-11-05");
		expect(negotiateProtocolVersion("2025-03-26")).toBe("2025-03-26");
		expect(negotiateProtocolVersion("2025-06-18")).toBe("2025-06-18");
	});
	test("falls back to latest for unknown/absent", () => {
		expect(negotiateProtocolVersion("1999-01-01")).toBe(LATEST_PROTOCOL_VERSION);
		expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
		expect(negotiateProtocolVersion(42)).toBe(LATEST_PROTOCOL_VERSION);
	});
});

describe("parseJsonRpcBody", () => {
	test("parse error", () => {
		const r = parseJsonRpcBody("{nope");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.response.error?.code).toBe(-32700);
	});
	test("batch rejected", () => {
		const r = parseJsonRpcBody("[]");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.response.error?.code).toBe(-32600);
	});
	test("invalid envelope rejected", () => {
		for (const raw of ['{"jsonrpc":"1.0","method":"x"}', '{"jsonrpc":"2.0"}', '"str"', "null"]) {
			const r = parseJsonRpcBody(raw);
			expect(r.ok).toBe(false);
		}
	});
	test("valid message passes through", () => {
		const r = parseJsonRpcBody('{"jsonrpc":"2.0","id":7,"method":"ping"}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.msg.method).toBe("ping");
	});
});

describe("handleRpcMessage", () => {
	test("initialize negotiates version + advertises tools capability", async () => {
		const r = await handleRpcMessage(msg("initialize", { protocolVersion: "2024-11-05" }), deps);
		expect(r.status).toBe(200);
		const result = r.body?.result as {
			protocolVersion: string;
			capabilities: unknown;
			serverInfo: { name: string };
		};
		expect(result.protocolVersion).toBe("2024-11-05");
		expect(result.capabilities).toEqual({ tools: {} });
		expect(result.serverInfo.name).toBe("revklik-mcp");
	});

	test("notifications get 202 with no body", async () => {
		for (const m of ["notifications/initialized", "notifications/cancelled"]) {
			const r = await handleRpcMessage(msg(m, undefined, null), deps);
			expect(r.status).toBe(202);
			expect(r.body).toBeNull();
		}
	});

	test("ping", async () => {
		const r = await handleRpcMessage(msg("ping"), deps);
		expect(r.status).toBe(200);
		expect(r.body?.result).toEqual({});
	});

	test("tools/list returns tools array directly (not content-wrapped)", async () => {
		const r = await handleRpcMessage(msg("tools/list"), deps);
		const result = r.body?.result as { tools: unknown[] };
		expect(Array.isArray(result.tools)).toBe(true);
		expect((result.tools[0] as { name: string }).name).toBe("whoami");
	});

	test("tools/call success wraps data in single text block", async () => {
		const r = await handleRpcMessage(
			msg("tools/call", { name: "whoami", arguments: { a: 1 } }),
			deps,
		);
		const result = r.body?.result as { content: { type: string; text: string }[] };
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(JSON.parse(result.content[0].text)).toEqual({ echoed: { a: 1 } });
		expect((result as { isError?: boolean }).isError).toBeUndefined();
	});

	test("tools/call business error becomes isError result", async () => {
		const r = await handleRpcMessage(msg("tools/call", { name: "boom" }), deps);
		const result = r.body?.result as { content: { text: string }[]; isError: boolean };
		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0].text)).toEqual({ error: "nope", hint: "try again" });
	});

	test("tools/call thrown error becomes -32603", async () => {
		const r = await handleRpcMessage(msg("tools/call", { name: "throw" }), deps);
		expect(r.body?.error?.code).toBe(-32603);
		expect(r.body?.error?.message).toBe("kaboom");
	});

	test("tools/call string result passes through verbatim (CSV path)", async () => {
		const r = await handleRpcMessage(msg("tools/call", { name: "csv-tool" }), {
			...deps,
			callTool: async () => ({ ok: true, data: "# csv export: x.csv\na,b\n1,2" }),
		});
		const result = r.body?.result as { content: { text: string }[] };
		expect(result.content[0].text).toBe("# csv export: x.csv\na,b\n1,2");
	});

	test("tools/call -32602-marked outcome becomes a JSON-RPC error", async () => {
		const r = await handleRpcMessage(msg("tools/call", { name: "ghost" }), {
			...deps,
			callTool: async () => ({ ok: false, error: "Unknown tool: ghost", code: -32602 }),
		});
		expect(r.body?.error?.code).toBe(-32602);
		expect((r.body?.result as { isError?: boolean } | undefined)?.isError).toBeUndefined();
	});

	test("tools/call missing name becomes -32602", async () => {
		const r = await handleRpcMessage(msg("tools/call", {}), deps);
		expect(r.body?.error?.code).toBe(-32602);
	});

	test("unknown method becomes -32601 with 404 status", async () => {
		const r = await handleRpcMessage(msg("resources/list"), deps);
		expect(r.status).toBe(404);
		expect(r.body?.error?.code).toBe(-32601);
	});

	test("rpcOk shape", () => {
		expect(rpcOk(3, { x: 1 })).toEqual({ jsonrpc: "2.0", id: 3, result: { x: 1 } });
	});
});

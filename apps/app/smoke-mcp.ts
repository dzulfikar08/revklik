/** Local MCP + v1 smoke: bun run apps/app/smoke-mcp.ts */
const BASE = "http://localhost:5173";
const ACCT = "rvt_af50f0ed64ea116d567b8be62f92f77195559ffd1fa50fc1413131bb56051b07";
const SITE = "rv_a5d03eeff82afb7b69599f42473fdc3c543d03658c1fc178b9b714c5796bb4f9";

const rpc = (method: string, params?: unknown, id: number | string | null = 1) =>
	JSON.stringify({ jsonrpc: "2.0", id, method, params });

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, extra?: unknown) => {
	if (cond) {
		pass++;
		console.log(`ok   ${label}`);
	} else {
		fail++;
		console.log(`FAIL ${label}`, extra ?? "");
	}
};

async function post(body: string, token = ACCT, extraHeaders: Record<string, string> = {}) {
	const res = await fetch(`${BASE}/api/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			...extraHeaders,
		},
		body,
	});
	return {
		status: res.status,
		json: await res.json().catch(() => null),
		text: await res.text().catch(() => ""),
	};
}

async function get(path: string, token?: string) {
	const res = await fetch(`${BASE}${path}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
	return { status: res.status, json: await res.json().catch(() => null) };
}

// --- Transport-level ---
{
	const res = await fetch(`${BASE}/api/mcp`, { headers: { Accept: "text/event-stream" } });
	check("GET + SSE accept → 405", res.status === 405);
}
{
	const res = await fetch(`${BASE}/api/mcp`, { method: "DELETE" });
	check("DELETE → 405", res.status === 405);
}
{
	const r = await post(rpc("initialize"), "rv_badtoken");
	check("POST bad token → 401", r.status === 401, r.status);
}
{
	const res = await fetch(`${BASE}/api/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"MCP-Protocol-Version": "1999-01-01",
			Authorization: `Bearer ${ACCT}`,
		},
		body: rpc("ping"),
	});
	check("unknown MCP-Protocol-Version header → 400", res.status === 400);
}
{
	const res = await fetch(`${BASE}/api/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCT}` },
		body: "{nope",
	});
	const j = await res.json();
	check("bad JSON → -32700", res.status === 400 && j.error?.code === -32700, j);
}

// --- JSON-RPC dispatch ---
{
	const r = await post(rpc("initialize", { protocolVersion: "2024-11-05" }));
	check(
		"initialize echoes 2024-11-05 + revklik-mcp",
		r.json?.result?.protocolVersion === "2024-11-05" &&
			r.json?.result?.serverInfo?.name === "revklik-mcp",
		r.json,
	);
}
{
	const r = await post(rpc("initialize", { protocolVersion: "2099-01-01" }));
	check(
		"initialize unknown version → latest",
		r.json?.result?.protocolVersion === "2025-06-18",
		r.json,
	);
}
{
	const res = await fetch(`${BASE}/api/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCT}` },
		body: rpc("notifications/initialized", undefined, null),
	});
	check("notifications/initialized → 202 empty", res.status === 202 && (await res.text()) === "");
}
{
	const r = await post(rpc("ping"));
	check("ping → {}", r.json?.result && Object.keys(r.json.result).length === 0, r.json);
}
{
	const r = await post(rpc("resources/list"));
	check("unknown method → -32601/404", r.status === 404 && r.json?.error?.code === -32601, r.json);
}
{
	const r = await post(rpc("tools/list"));
	const tools = r.json?.result?.tools ?? [];
	check(
		"tools/list → 12 tools",
		tools.length === 12,
		tools.map((t: { name: string }) => t.name),
	);
	check(
		"tools/list names",
		JSON.stringify(tools.map((t: { name: string }) => t.name)) ===
			JSON.stringify([
				"whoami",
				"list_sites",
				"analytics_overview",
				"analytics_timeseries",
				"top_pages",
				"top_referrers",
				"geo_breakdown",
				"device_breakdown",
				"revenue_breakdown",
				"campaigns",
				"visitor_journeys",
				"export_events",
			]),
	);
}

// --- tools/call with account token ---
{
	const r = await post(rpc("tools/call", { name: "whoami" }));
	const text = r.json?.result?.content?.[0]?.text;
	const data = JSON.parse(text ?? "{}");
	check(
		"whoami → user + scopes",
		data?.user?.email === "smoke@revklik.test" &&
			data?.plan === "growth" &&
			data?.token?.type === "account",
		data,
	);
}
{
	const r = await post(rpc("tools/call", { name: "list_sites" }));
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "[]");
	check("list_sites → 2 sites", data?.length === 2 && data[0]?.domain === "other.test", data);
}
{
	const r = await post(
		rpc("tools/call", {
			name: "analytics_overview",
			arguments: { site_id: "site_smoke", range: "7d" },
		}),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"analytics_overview → pageviews 3, visitors 2, revenue 150000, conversions 1",
		data?.pageviews === 3 &&
			data?.visitors === 2 &&
			data?.revenue === 150000 &&
			data?.conversions === 1,
		data,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "analytics_timeseries", arguments: { site_id: "site_smoke" } }),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "[]");
	check(
		"analytics_timeseries → 1 bucket (7d > 48h → daily)",
		data?.length === 1 && data[0]?.pageviews === 3,
		data,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "top_pages", arguments: { site_id: "site_smoke" } }),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "[]");
	check(
		"top_pages → '/' first with 2 views",
		data?.[0]?.path === "/" && data?.[0]?.pageviews === 2,
		data,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "top_referrers", arguments: { site_id: "site_smoke" } }),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "[]");
	check(
		"top_referrers → google 1, direct 1",
		data?.length === 2 && data[0]?.source === "google",
		data,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "campaigns", arguments: { site_id: "site_smoke" } }),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "[]");
	check(
		"campaigns → ramadan-sale conv rate 100%",
		data?.[0]?.utm_campaign === "ramadan-sale" && data[0]?.conversionRate === 100,
		data,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "revenue_breakdown", arguments: { site_id: "site_smoke" } }),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"revenue_breakdown → bySource google 150000",
		data?.bySource?.[0]?.revenue === 150000,
		data,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "visitor_journeys", arguments: { site_id: "site_smoke" } }),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "[]");
	// sessions ordered started_at desc: ses_2 (anonymous, 11:00) before ses_1 (Budi, 10:00)
	check(
		"visitor_journeys → newest first; Budi row identified with 3 steps + revenue",
		data?.length === 2 &&
			data[0]?.is_identified === false &&
			data[1]?.visitor_name === "Budi" &&
			data[1]?.steps?.length === 3 &&
			data[1]?.total_revenue === 150000,
		data?.map((d: { visitor_name: string | null }) => d.visitor_name),
	);
}
{
	const r = await post(
		rpc("tools/call", {
			name: "export_events",
			arguments: { site_id: "site_smoke", type: "events" },
		}),
	);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"export_events json → count 5, props parsed to pr",
		data?.count === 5 &&
			data?.data?.[2]?.pr?.order_id === "ORD-1" &&
			data?.data?.[2]?.props === undefined,
		data?.data?.[2],
	);
}
{
	const r = await post(
		rpc("tools/call", {
			name: "export_events",
			arguments: { site_id: "site_smoke", format: "csv" },
		}),
	);
	const text = r.json?.result?.content?.[0]?.text ?? "";
	check(
		"export_events csv → header comment + 5 rows",
		text.startsWith("# csv export: events-site_smoke-30d.csv") &&
			text.trim().split("\n").length === 7,
		text.split("\n")[1],
	);
}

// --- error paths (account token) ---
{
	const r = await post(rpc("tools/call", { name: "no_such_tool" }));
	check("unknown tool → -32602", r.json?.error?.code === -32602, r.json);
}
{
	const r = await post(rpc("tools/call", { name: "analytics_overview", arguments: {} }));
	const result = r.json?.result;
	check(
		"missing site_id → isError 400 + hint",
		result?.isError === true && JSON.parse(result.content[0].text).error === "site_id required",
		result,
	);
}
{
	const r = await post(
		rpc("tools/call", { name: "analytics_overview", arguments: { site_id: "site_ghost" } }),
	);
	const parsed = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"unknown site → isError 404 + list_sites hint",
		r.json?.result?.isError === true &&
			parsed.error === "Site not found" &&
			parsed.hint?.includes("list_sites"),
		parsed,
	);
}

// --- site token (rv_) ---
{
	const r = await post(rpc("tools/call", { name: "analytics_overview", arguments: {} }), SITE);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check("rv_ + omitted site_id → bound site default", data?.pageviews === 3, data);
}
{
	const r = await post(
		rpc("tools/call", { name: "analytics_overview", arguments: { site_id: "site_other" } }),
		SITE,
	);
	const parsed = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"rv_ + other site → isError 403",
		r.json?.result?.isError === true && parsed.error.includes("not valid"),
		parsed,
	);
}
{
	const r = await post(rpc("tools/call", { name: "list_sites" }), SITE);
	const parsed = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"rv_ list_sites → isError 403 scope",
		r.json?.result?.isError === true && parsed.error.includes("sites:read"),
		parsed,
	);
}
{
	const r = await post(rpc("tools/call", { name: "whoami" }), SITE);
	const data = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
	check(
		"rv_ whoami → site_id binding",
		data?.token?.site_id === "site_smoke" && data?.token?.type === "site",
		data,
	);
}

// --- v1 REST parity spot checks (rewired routes) ---
{
	const r = await get("/api/v1/whoami", ACCT);
	check(
		"v1 whoami envelope",
		r.status === 200 &&
			r.json?.success === true &&
			r.json?.data?.user?.email === "smoke@revklik.test",
		r.json,
	);
}
{
	const r = await get("/api/v1/sites", ACCT);
	check("v1 sites → 2", r.status === 200 && r.json?.data?.length === 2, r.json);
}
{
	const r = await get("/api/v1/analytics/overview?site_id=site_smoke&range=7d", ACCT);
	check(
		"v1 overview envelope identical shape",
		r.status === 200 &&
			r.json?.success === true &&
			r.json?.data?.pageviews === 3 &&
			r.json?.data?.revenue === 150000,
		r.json,
	);
}
{
	const r = await get("/api/v1/analytics/overview", ACCT);
	check(
		"v1 missing site_id → 400 envelope",
		r.status === 400 && r.json?.error === "site_id required" && r.json?.success === false,
		r.json,
	);
}
{
	const r = await get("/api/v1/analytics/overview?site_id=site_ghost", ACCT);
	check(
		"v1 unknown site → 404 envelope",
		r.status === 404 && r.json?.error === "Site not found",
		r.json,
	);
}
{
	const r = await get("/api/v1/analytics/overview?site_id=site_other", SITE);
	check(
		"v1 rv_ mismatch → 403 envelope",
		r.status === 403 && r.json?.error === "Token not valid for this site",
		r.json,
	);
}
{
	const r = await get("/api/v1/analytics/overview?site_id=site_smoke", SITE);
	check("v1 rv_ own site → 200", r.status === 200 && r.json?.data?.pageviews === 3, r.json);
}
{
	const r = await get("/api/v1/sites", SITE);
	check(
		"v1 rv_ sites → 403 scope",
		r.status === 403 && r.json?.error === "Insufficient scope" && r.json?.required === "sites:read",
		r.json,
	);
}
{
	const res = await fetch(
		`${BASE}/api/v1/analytics/export?site_id=site_smoke&format=csv&type=events`,
		{
			headers: { Authorization: `Bearer ${ACCT}` },
		},
	);
	const text = await res.text();
	check(
		"v1 export csv → headers + rows",
		res.status === 200 &&
			(res.headers.get("Content-Type") === "text/csv" ||
				res.headers.get("Content-Type")?.startsWith("text/csv")) &&
			(res.headers.get("Content-Disposition") ?? "").includes("events-site_smoke-30d.csv") &&
			text.trim().split("\n").length === 6,
		{ ct: res.headers.get("Content-Type"), cd: res.headers.get("Content-Disposition") },
	);
}
{
	const r = await get("/api/v1/analytics/journeys?site_id=site_smoke", ACCT);
	check(
		"v1 journeys envelope (desc; Budi at index 1)",
		r.status === 200 &&
			r.json?.data?.[1]?.visitor_name === "Budi" &&
			r.json?.data?.[1]?.steps?.length === 3,
		r.json?.data?.map((d: { visitor_name: string | null }) => d.visitor_name),
	);
}
{
	const r = await get("/api/v1/analytics/campaigns?site_id=site_smoke", ACCT);
	check(
		"v1 campaigns",
		r.status === 200 && r.json?.data?.[0]?.utm_campaign === "ramadan-sale",
		r.json,
	);
}
{
	const r = await get("/api/v1/analytics/devices?site_id=site_smoke", ACCT);
	check("v1 devices", r.status === 200 && r.json?.data?.devices?.length === 2, r.json);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);

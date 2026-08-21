import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { getActiveSiteId } from "@/lib/api";
import { getItemSync } from "@/lib/mobile-storage";

export const Route = createFileRoute("/settings/api-playground")({
	component: APIPlaygroundPage,
});

type EndpointDef = {
	method: string;
	path: string;
	desc: string;
	params: string[];
};

const ENDPOINTS: EndpointDef[] = [
	{ method: "GET", path: "/v1/whoami", desc: "Current user info", params: [] },
	{ method: "GET", path: "/v1/sites", desc: "List all sites", params: [] },
	{
		method: "GET",
		path: "/v1/analytics/overview",
		desc: "Analytics overview",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/timeseries",
		desc: "Time series data",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/top-pages",
		desc: "Top pages",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/referrers",
		desc: "Traffic referrers",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/devices",
		desc: "Device breakdown",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/geo",
		desc: "Geographic data",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/revenue/sources",
		desc: "Revenue by source",
		params: ["site_id", "range"],
	},
	{
		method: "GET",
		path: "/v1/analytics/export",
		desc: "Export data (CSV/JSON)",
		params: ["site_id", "type", "format", "range"],
	},
	{ method: "GET", path: "/v1/tokens", desc: "List API tokens", params: [] },
	{ method: "POST", path: "/v1/tokens", desc: "Create API token", params: [] },
	{
		method: "DELETE",
		path: "/v1/tokens/:id",
		desc: "Revoke API token",
		params: ["id"],
	},
];

const METHOD_COLORS: Record<string, { bg: string; color: string }> = {
	GET: { bg: "rgba(52,211,153,.15)", color: "#34d399" },
	POST: { bg: "rgba(96,165,250,.15)", color: "#60a5fa" },
	DELETE: { bg: "rgba(248,113,113,.15)", color: "#f87171" },
};

function methodBadge(method: string) {
	const c = METHOD_COLORS[method] ?? {
		bg: "var(--bg3)",
		color: "var(--text3)",
	};
	return (
		<span
			style={{
				fontFamily: "var(--mono)",
				fontSize: 10,
				fontWeight: 600,
				padding: "2px 6px",
				borderRadius: 4,
				background: c.bg,
				color: c.color,
			}}
		>
			{method}
		</span>
	);
}

function APIPlaygroundPage() {
	const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
	const [paramValues, setParamValues] = useState<Record<string, string>>({});
	const [requestBody, setRequestBody] = useState("");
	const [response, setResponse] = useState<string | null>(null);
	const [status, setStatus] = useState<number | null>(null);
	const [responseTime, setResponseTime] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);

	const selected = selectedIdx !== null ? ENDPOINTS[selectedIdx] : null;

	const activeSiteId = getActiveSiteId();

	function handleSelect(idx: number) {
		setSelectedIdx(idx);
		setResponse(null);
		setStatus(null);
		setResponseTime(null);
		setRequestBody("");

		const ep = ENDPOINTS[idx];
		const defaults: Record<string, string> = {};
		for (const p of ep.params) {
			if (p === "site_id" && activeSiteId) defaults[p] = activeSiteId;
			else if (p === "range") defaults[p] = "7d";
		}
		setParamValues(defaults);
	}

	function updateParam(key: string, value: string) {
		setParamValues((prev) => ({ ...prev, [key]: value }));
	}

	async function sendRequest() {
		if (!selected) return;
		const token = getItemSync("kp_token");
		if (!token) return;

		setLoading(true);
		setResponse(null);
		setStatus(null);
		setResponseTime(null);

		// Build URL — replace path params like :id
		let resolvedPath = selected.path;
		for (const p of selected.params) {
			const val = paramValues[p] ?? "";
			if (resolvedPath.includes(`:${p}`)) {
				resolvedPath = resolvedPath.replace(`:${p}`, val);
			}
		}

		// Build query string for non-path params
		const queryParams = new URLSearchParams();
		for (const p of selected.params) {
			if (!selected.path.includes(`:${p}`)) {
				const val = paramValues[p];
				if (val) queryParams.set(p, val);
			}
		}

		const qs = queryParams.toString();
		const url = `${window.location.origin}/api${resolvedPath}${qs ? `?${qs}` : ""}`;

		const start = performance.now();

		try {
			const opts: RequestInit = {
				method: selected.method,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			};

			if (selected.method !== "GET" && requestBody.trim()) {
				opts.body = requestBody;
			}

			const res = await fetch(url, opts);
			const elapsed = Math.round(performance.now() - start);
			setStatus(res.status);
			setResponseTime(elapsed);

			const text = await res.text();
			try {
				const json = JSON.parse(text);
				setResponse(JSON.stringify(json, null, 2));
			} catch {
				setResponse(text);
			}
		} catch (err) {
			const elapsed = Math.round(performance.now() - start);
			setResponseTime(elapsed);
			setStatus(null);
			setResponse(`Error: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setLoading(false);
		}
	}

	function statusColor(code: number | null) {
		if (!code) return "var(--text3)";
		if (code >= 200 && code < 300) return "#34d399";
		if (code >= 400 && code < 500) return "#fbbf24";
		return "#f87171";
	}

	const baseUrl = `${window.location.origin}/api`;

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<div style={{ padding: "0 24px" }}>
				<PageHeader
					title="API Playground"
					subtitle="Test API endpoints interactively"
					backTo="/settings"
					badge={baseUrl}
				/>
			</div>

			{/* Two-column layout */}
			<div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
				{/* Left panel — endpoint list */}
				<div
					style={{
						width: 280,
						minWidth: 280,
						borderRight: "1px solid var(--border)",
						overflowY: "auto",
						background: "var(--bg2)",
					}}
				>
					{ENDPOINTS.map((ep, idx) => (
						<button
							type="button"
							key={ep.path + ep.method}
							onClick={() => handleSelect(idx)}
							style={{
								display: "block",
								width: "100%",
								textAlign: "left",
								fontFamily: "inherit",
								fontSize: "inherit",
								color: "inherit",
								border: "none",
								borderBottom: "1px solid var(--border)",
								borderRadius: 0,
								padding: "8px 12px",
								cursor: "pointer",
								background: selectedIdx === idx ? "var(--accent-dim)" : "transparent",
								transition: "background 0.15s ease",
							}}
							onMouseEnter={(e) => {
								if (selectedIdx !== idx) {
									(e.currentTarget as HTMLButtonElement).style.background = "var(--bg3)";
								}
							}}
							onMouseLeave={(e) => {
								if (selectedIdx !== idx) {
									(e.currentTarget as HTMLButtonElement).style.background = "transparent";
								}
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									marginBottom: 2,
								}}
							>
								{methodBadge(ep.method)}
								<span
									style={{
										fontFamily: "var(--mono)",
										fontSize: 11,
										color: "var(--text2)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{ep.path}
								</span>
							</div>
							<div style={{ fontSize: 11, color: "var(--text3)", paddingLeft: 2 }}>{ep.desc}</div>
						</button>
					))}
				</div>

				{/* Right panel — request builder + response */}
				<div
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					{selected ? (
						<>
							{/* Request builder */}
							<div
								style={{
									padding: "16px 24px",
									borderBottom: "1px solid var(--border)",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 10,
										marginBottom: 12,
									}}
								>
									{methodBadge(selected.method)}
									<span
										style={{
											fontFamily: "var(--mono)",
											fontSize: 13,
											color: "var(--text)",
											fontWeight: 600,
										}}
									>
										{selected.path}
									</span>
									<span style={{ fontSize: 12, color: "var(--text3)" }}>
										&mdash; {selected.desc}
									</span>
								</div>

								{/* Param inputs */}
								{selected.params.length > 0 && (
									<div
										style={{
											display: "flex",
											gap: 8,
											flexWrap: "wrap",
											marginBottom: 12,
										}}
									>
										{selected.params.map((p) => (
											<div
												key={p}
												style={{
													display: "flex",
													flexDirection: "column",
													gap: 4,
													minWidth: 140,
													flex: 1,
												}}
											>
												<label
													htmlFor={`param-${p}`}
													style={{
														fontFamily: "var(--mono)",
														fontSize: 10,
														fontWeight: 600,
														color: "var(--text3)",
														textTransform: "uppercase" as const,
														letterSpacing: "0.08em",
													}}
												>
													{p}
												</label>
												<input
													id={`param-${p}`}
													value={paramValues[p] ?? ""}
													onChange={(e) => updateParam(p, e.target.value)}
													placeholder={p}
													style={{
														width: "100%",
														padding: "6px 10px",
														borderRadius: 6,
														border: "1px solid var(--border)",
														background: "var(--bg)",
														color: "var(--text)",
														fontFamily: "var(--mono)",
														fontSize: 12,
													}}
												/>
											</div>
										))}
									</div>
								)}

								{/* Request body for POST/DELETE */}
								{(selected.method === "POST" || selected.method === "DELETE") && (
									<div style={{ marginBottom: 12 }}>
										<label
											htmlFor="request-body"
											style={{
												fontFamily: "var(--mono)",
												fontSize: 10,
												fontWeight: 600,
												color: "var(--text3)",
												textTransform: "uppercase" as const,
												letterSpacing: "0.08em",
												display: "block",
												marginBottom: 4,
											}}
										>
											Request Body (JSON)
										</label>
										<textarea
											id="request-body"
											value={requestBody}
											onChange={(e) => setRequestBody(e.target.value)}
											placeholder='{"name": "My Token", "type": "account"}'
											rows={4}
											style={{
												width: "100%",
												padding: "10px 12px",
												borderRadius: 8,
												border: "1px solid var(--border)",
												background: "var(--bg)",
												color: "var(--text)",
												fontFamily: "var(--mono)",
												fontSize: 12,
												resize: "vertical",
												boxSizing: "border-box",
											}}
										/>
									</div>
								)}

								{/* Send button */}
								<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
									<button
										type="button"
										className="btn-accent"
										onClick={sendRequest}
										disabled={loading}
										style={{
											fontSize: 12,
											padding: "6px 16px",
											opacity: loading ? 0.6 : 1,
											display: "flex",
											alignItems: "center",
											gap: 6,
										}}
									>
										{loading ? (
											<>
												<span className="spinner" style={{ width: 14, height: 14 }} />
												Sending...
											</>
										) : (
											"Send"
										)}
									</button>

									{/* Status + timing */}
									{status !== null && (
										<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
											<span
												style={{
													fontFamily: "var(--mono)",
													fontSize: 11,
													fontWeight: 600,
													padding: "2px 8px",
													borderRadius: 4,
													background:
														status >= 200 && status < 300
															? "rgba(52,211,153,.15)"
															: status >= 400 && status < 500
																? "rgba(251,191,36,.15)"
																: "rgba(248,113,113,.15)",
													color: statusColor(status),
												}}
											>
												{status}
											</span>
											{responseTime !== null && (
												<span
													style={{
														fontFamily: "var(--mono)",
														fontSize: 11,
														color: "var(--text3)",
													}}
												>
													{responseTime}ms
												</span>
											)}
										</div>
									)}
								</div>
							</div>

							{/* Response viewer */}
							<div style={{ flex: 1, overflow: "hidden", padding: "16px 24px" }}>
								{response !== null ? (
									<pre
										style={{
											background: "var(--bg3)",
											borderRadius: 8,
											padding: 16,
											fontFamily: "var(--mono)",
											fontSize: 12,
											maxHeight: 500,
											overflow: "auto",
											margin: 0,
											color: "var(--text)",
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
										}}
									>
										{response}
									</pre>
								) : !loading ? (
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											height: "100%",
											color: "var(--text4)",
											fontSize: 13,
										}}
									>
										Select an endpoint and click Send to see the response
									</div>
								) : null}
							</div>
						</>
					) : (
						<div
							style={{
								flex: 1,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: "var(--text4)",
								fontSize: 13,
							}}
						>
							Select an endpoint from the left panel
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

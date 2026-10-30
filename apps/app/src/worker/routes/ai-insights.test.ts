import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";

type Body = {
	data: {
		insights: { summary: string }[];
		data_summary: { currency?: string; total_revenue: number };
	};
};

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();

/** IDR site with revenue spread over two sources so the fallback insights fire. */
async function idrSite(): Promise<{ t: MigratedTestApp; token: string }> {
	const t = await createMigratedTestApp();
	const token = await t.seedUser({ id: "u-ai", plan: "growth", withSite: "s-ai" });
	t.db.exec(
		"UPDATE sites SET revenue_currency = 'IDR', revenue_currency_source = 'manual' WHERE id = 's-ai'",
	);
	const add = (amount: number, source: string, country: string) =>
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path, event_type, revenue, currency, utm_source, country) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
			)
			.run(
				crypto.randomUUID(),
				"s-ai",
				"sess",
				crypto.randomUUID(),
				new Date().toISOString(),
				"/",
				"conversion",
				amount,
				"IDR",
				source,
				country,
			);
	add(3_000_000, "google", "ID");
	add(500_000, "twitter", "SG");
	return { t, token };
}

/** A cached row written before insights carried a currency ("$" amounts). */
function staleDollarRow(t: MigratedTestApp, createdAt: string, expiresAt: string): void {
	t.db
		.prepare(
			"INSERT INTO ai_insights (id, site_id, range, insight_type, insight_text, data_refs, confidence, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"stale",
			"s-ai",
			"7d",
			"revenue_drivers",
			JSON.stringify({ title: "t", summary: "google earns $232.00", detail: "", action: null }),
			JSON.stringify({ totalEvents: 2, totalRevenue: 232 }),
			0.8,
			createdAt,
			expiresAt,
		);
}

const get = async (t: MigratedTestApp, token: string, lang?: string): Promise<Body> => {
	const res = await t.call(
		"GET",
		`/api/ai-insights?site_id=s-ai&range=7d${lang ? `&lang=${lang}` : ""}`,
		{ token },
	);
	expect(res.status).toBe(200);
	return (await res.json()) as Body;
};

describe("GET /ai-insights currency-aware cache", () => {
	it("treats an unexpired row without the site currency as a miss and regenerates", async () => {
		const { t, token } = await idrSite();
		staleDollarRow(t, hoursAgo(2), inHours(2));

		const body = await get(t, token);

		expect(body.data.data_summary.currency).toBe("IDR");
		const text = body.data.insights.map((i) => i.summary).join(" ");
		expect(text).toContain("Rp 3.000.000");
		expect(text).not.toContain("$");
		// The stale batch is replaced, not mixed into the next read.
		expect(t.db.query("SELECT COUNT(*) AS n FROM ai_insights WHERE id = 'stale'").get()).toEqual({
			n: 0,
		});
	});

	it("does not serve a currency-mismatched row while rate-limited", async () => {
		const { t, token } = await idrSite();
		// Written minutes ago: inside the 1h rate-limit window.
		staleDollarRow(t, hoursAgo(0.1), inHours(2));

		const body = await get(t, token);

		expect(body.data.data_summary.currency).toBe("IDR");
		const text = body.data.insights.map((i) => i.summary).join(" ");
		expect(text).toContain("Rp 3.000.000");
		expect(text).not.toContain("$232.00");
	});

	it("serves a cached row written in the site currency", async () => {
		const { t, token } = await idrSite();
		t.db
			.prepare(
				"INSERT INTO ai_insights (id, site_id, range, insight_type, insight_text, data_refs, confidence, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
			)
			.run(
				"fresh",
				"s-ai",
				"7d",
				"revenue_drivers",
				JSON.stringify({ title: "t", summary: "cached Rp 1", detail: "", action: null }),
				JSON.stringify({ totalEvents: 2, totalRevenue: 1, currency: "IDR" }),
				0.8,
				hoursAgo(0.1),
				inHours(2),
			);

		const body = await get(t, token);

		expect(body.data.insights.map((i) => i.summary)).toEqual(["cached Rp 1"]);
		expect(body.data.data_summary.currency).toBe("IDR");
	});
});

describe("GET /ai-insights language", () => {
	it("writes insights in Bahasa Indonesia for lang=id without reusing the English cache", async () => {
		const { t, token } = await idrSite();

		const en = await get(t, token);
		const id = await get(t, token, "id");

		const enText = en.data.insights.map((i) => i.summary).join(" ");
		const idText = id.data.insights.map((i) => i.summary).join(" ");
		expect(enText).toContain("brought in Rp 3.000.000");
		expect(idText).toContain("membawa Rp 3.000.000");
		expect(idText).not.toContain("brought in");
		// Each language keeps its own cached batch (same rows, row order is not specified).
		const summaries = async (lang?: string) =>
			(await get(t, token, lang)).data.insights.map((i) => i.summary).sort();
		expect(await summaries()).toEqual(en.data.insights.map((i) => i.summary).sort());
		expect(await summaries("id")).toEqual(id.data.insights.map((i) => i.summary).sort());
	});

	it("treats an unknown lang as English", async () => {
		const { t, token } = await idrSite();
		const body = await get(t, token, "xx");
		expect(body.data.insights.map((i) => i.summary).join(" ")).toContain("brought in");
	});
});

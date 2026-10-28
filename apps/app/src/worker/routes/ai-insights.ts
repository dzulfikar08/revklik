import { type Context, Hono } from "hono";
import type { Compilable, Kysely } from "kysely";
import type {
	AiInsight,
	AiInsightTable,
	InsightsResponse,
	InsightType,
	KlikapaDatabase,
} from "@revklik/shared";
import {
	type AggregatedData,
	type AiBinding,
	type RawInsight,
	aggregateData,
	callWorkersAI,
	generateFallbackInsights,
} from "../lib/ai-prompts";
import { executeBatch } from "../lib/d1-batch";
import { planRequiredBody } from "../lib/plan-gate";
import { resolveQueryScope } from "../lib/site-scope";
import { isSelfHosted } from "../lib/entitlement";
import { requirePlanForSite } from "../lib/plans";
import { generateId, getDateRange } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = {
	Bindings: { DB: D1Database; AI?: AiBinding; FX_USD_IDR?: string; SELF_HOSTED?: string };
	Variables: Variables;
};

export const aiInsightsRoutes = new Hono<Env>();

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
	return db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
}

/** Cache TTL in hours based on range */
function getCacheTtlHours(range: string): number {
	if (range === "90d") return 24;
	if (range === "30d") return 12;
	return 4; // 24h, 7d
}

/** Rate limit window: max 1 AI call per site per hour */
const RATE_LIMIT_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// GET /ai-insights
// ---------------------------------------------------------------------------
aiInsightsRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const range = c.req.query("range") || "7d";

	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const validRanges = ["24h", "7d", "30d", "90d"];
	if (!validRanges.includes(range)) {
		return c.json({ error: "Invalid range. Use 24h, 7d, 30d, or 90d", success: false }, 400);
	}

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const planCheck = await requirePlanForSite(db, userId, siteId, 2, isSelfHosted(c.env));
	if (!planCheck.allowed) return c.json(planRequiredBody("growth", planCheck.plan), 403);

	const now = new Date().toISOString();
	const ttlHours = getCacheTtlHours(range);
	// Cached insight text has amounts baked in, so a row is only reusable when
	// it was written in the site's current display currency.
	const scope = await resolveQueryScope(db, siteId, c.env, undefined);
	const currency = scope.money.currency;

	// Check for non-expired cached insights
	const cached = rowsInCurrency(
		await db
			.selectFrom("ai_insights")
			.selectAll()
			.where("site_id", "=", siteId)
			.where("range", "=", range)
			.where("expires_at", ">", now)
			.orderBy("created_at", "desc")
			.execute(),
		currency,
	);

	if (cached.length > 0) {
		return c.json({ data: buildResponse(cached, range), success: true });
	}

	// Cache miss — check rate limit before calling AI
	const recentCall = await db
		.selectFrom("ai_insights")
		.select(["created_at"])
		.where("site_id", "=", siteId)
		.where("range", "=", range)
		.orderBy("created_at", "desc")
		.limit(1)
		.executeTakeFirst();

	if (recentCall) {
		const elapsed = Date.now() - new Date(recentCall.created_at).getTime();
		if (elapsed < RATE_LIMIT_MS) {
			// Rate limited: reuse expired cache in the right currency, otherwise
			// the rule-based insights (no AI call, nothing cached).
			const expired = rowsInCurrency(
				await db
					.selectFrom("ai_insights")
					.selectAll()
					.where("site_id", "=", siteId)
					.where("range", "=", range)
					.orderBy("created_at", "desc")
					.execute(),
				currency,
			);

			if (expired.length > 0) {
				return c.json({ data: buildResponse(expired, range), success: true });
			}
			try {
				const { start } = getDateRange(range);
				const data = await aggregateData(db, siteId, start.toISOString(), scope.money);
				return c.json({
					data: freshResponse(
						generateFallbackInsights(data),
						data,
						range,
						new Date().toISOString(),
					),
					success: true,
					message: "Insights generation rate-limited. Showing rule-based insights.",
				});
			} catch (err) {
				console.error("Rule-based insights failed:", err);
				return c.json({ data: emptyResponse(range), success: true });
			}
		}
	}

	// Generate fresh insights
	const insights = await generateInsights(c, db, siteId, range, ttlHours);
	return c.json({ data: insights, success: true });
});

// ---------------------------------------------------------------------------
// POST /ai-insights/refresh
// ---------------------------------------------------------------------------
aiInsightsRoutes.post("/refresh", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const body = await c.req.json().catch(() => ({}));
	const siteId = body.site_id as string | undefined;
	const range = (body.range as string) || "7d";

	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const validRanges = ["24h", "7d", "30d", "90d"];
	if (!validRanges.includes(range)) {
		return c.json({ error: "Invalid range. Use 24h, 7d, 30d, or 90d", success: false }, 400);
	}

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const planCheck = await requirePlanForSite(db, userId, siteId, 2, isSelfHosted(c.env));
	if (!planCheck.allowed) return c.json(planRequiredBody("growth", planCheck.plan), 403);

	// Delete cached insights for this site + range
	await db
		.deleteFrom("ai_insights")
		.where("site_id", "=", siteId)
		.where("range", "=", range)
		.execute();

	const ttlHours = getCacheTtlHours(range);
	const insights = await generateInsights(c, db, siteId, range, ttlHours);
	return c.json({ data: insights, success: true });
});

// ---------------------------------------------------------------------------
// Orchestrate generation: aggregate -> AI -> cache -> response
// ---------------------------------------------------------------------------

async function generateInsights(
	c: Context<Env>,
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	range: string,
	ttlHours: number,
): Promise<InsightsResponse> {
	const { start } = getDateRange(range);
	const startIso = start.toISOString();
	let currency = "USD";
	let data: AggregatedData | null = null;

	try {
		// Site display currency (with FX), so insight amounts match the dashboard.
		const scope = await resolveQueryScope(db, siteId, c.env, undefined);
		currency = scope.money.currency;
		data = await aggregateData(db, siteId, startIso, scope.money);
		const rawInsights = await callWorkersAI(c.env?.AI, data, range);

		const now = new Date();
		const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
		const createdAt = now.toISOString();

		// Replace the previous batch in one D1 batch (one transaction) so rows
		// from an older batch, another currency, or a concurrent writer never
		// mix into the next cache read.
		const writes: Compilable[] = [
			db.deleteFrom("ai_insights").where("site_id", "=", siteId).where("range", "=", range),
		];
		for (const insight of rawInsights) {
			const id = generateId();
			writes.push(
				db.insertInto("ai_insights").values({
					id,
					site_id: siteId,
					range,
					insight_type: insight.type,
					insight_text: JSON.stringify({
						title: insight.title,
						summary: insight.summary,
						detail: insight.detail,
						action: insight.action,
					}),
					data_refs: JSON.stringify(data),
					confidence: insight.confidence,
					created_at: createdAt,
					expires_at: expiresAt,
				}),
			);
		}
		if (c.env?.DB) await executeBatch(c.env.DB, writes, writes.length);
		else for (const q of writes) await db.executeQuery(q.compile());

		return freshResponse(rawInsights, data, range, createdAt);
	} catch (err) {
		console.error("Insight generation failed:", err);

		// Expired cache is only a fallback when it was written in this currency.
		const fallback = rowsInCurrency(
			await db
				.selectFrom("ai_insights")
				.selectAll()
				.where("site_id", "=", siteId)
				.where("range", "=", range)
				.orderBy("created_at", "desc")
				.execute(),
			currency,
		);

		if (fallback.length > 0) {
			return buildResponse(fallback, range);
		}
		// Aggregation worked but the AI call or the cache write failed.
		if (data) {
			return freshResponse(generateFallbackInsights(data), data, range, new Date().toISOString());
		}

		return emptyResponse(range);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Currency a cached row's amounts were written in; null for pre-currency rows. */
function rowCurrency(row: AiInsightTable): string | null {
	if (!row.data_refs) return null;
	try {
		const d: { currency?: unknown } = JSON.parse(row.data_refs);
		return typeof d.currency === "string" ? d.currency : null;
	} catch {
		return null;
	}
}

/** Cached rows usable for a site whose display currency is `currency`. */
export function rowsInCurrency(rows: AiInsightTable[], currency: string): AiInsightTable[] {
	return rows.filter((r) => rowCurrency(r) === currency);
}

function freshResponse(
	raw: RawInsight[],
	data: AggregatedData,
	range: string,
	createdAt: string,
): InsightsResponse {
	return {
		insights: raw.map((r, i) => ({
			id: `${createdAt}-${i}`,
			type: r.type,
			title: r.title,
			summary: r.summary,
			detail: r.detail,
			confidence: r.confidence,
			action: r.action,
		})),
		generated_at: createdAt,
		data_summary: {
			total_events: data.totalEvents,
			total_revenue: data.totalRevenue,
			date_range: range,
			currency: data.currency,
		},
	};
}

function buildResponse(rows: AiInsightTable[], range: string): InsightsResponse {
	const insights: AiInsight[] = rows.map((r, i) => {
		let parsed: { title?: string; summary?: string; detail?: string; action?: string | null } = {};
		try {
			parsed = JSON.parse(r.insight_text ?? "{}");
		} catch {
			/* keep empty */
		}
		return {
			id: r.id ?? `${i}`,
			type: (r.insight_type as InsightType) ?? "revenue_drivers",
			title: parsed.title ?? "",
			summary: parsed.summary ?? "",
			detail: parsed.detail ?? "",
			confidence: Number(r.confidence ?? 0),
			action: parsed.action ?? null,
		};
	});

	const dataRefs = rows[0]?.data_refs;
	let dataSummary: InsightsResponse["data_summary"] = {
		total_events: 0,
		total_revenue: 0,
		date_range: range,
	};
	if (dataRefs) {
		try {
			const d: { totalEvents?: number; totalRevenue?: number; currency?: string } =
				JSON.parse(dataRefs);
			dataSummary = {
				total_events: d.totalEvents ?? 0,
				total_revenue: d.totalRevenue ?? 0,
				date_range: range,
				// Rows cached before currency conversion carry raw (USD) sums.
				currency: d.currency ?? "USD",
			};
		} catch {
			/* keep default */
		}
	}

	return {
		insights,
		generated_at: rows[0]?.created_at ?? new Date().toISOString(),
		data_summary: dataSummary,
	};
}

function emptyResponse(range: string): InsightsResponse {
	return {
		insights: [],
		generated_at: new Date().toISOString(),
		data_summary: { total_events: 0, total_revenue: 0, date_range: range },
	};
}

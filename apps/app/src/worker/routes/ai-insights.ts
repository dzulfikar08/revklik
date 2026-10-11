import { type Context, Hono } from "hono";
import type { Kysely } from "kysely";
import type {
	AiInsight,
	AiInsightTable,
	InsightsResponse,
	InsightType,
	KlikapaDatabase,
} from "@revklik/shared";
import { type AiBinding, aggregateData, callWorkersAI } from "../lib/ai-prompts";
import { planRequiredBody } from "../lib/plan-gate";
import { requirePlan } from "../lib/plans";
import { generateId, getDateRange } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = {
	Bindings: { DB: D1Database; AI?: AiBinding };
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

	const planCheck = await requirePlan(db, userId, 2);
	if (!planCheck.allowed) return c.json(planRequiredBody("growth", planCheck.plan), 403);

	const now = new Date().toISOString();
	const ttlHours = getCacheTtlHours(range);

	// Check for non-expired cached insights
	const cached = await db
		.selectFrom("ai_insights")
		.selectAll()
		.where("site_id", "=", siteId)
		.where("range", "=", range)
		.where("expires_at", ">", now)
		.orderBy("created_at", "desc")
		.execute();

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
			// Rate limited — return expired cache if available, otherwise empty
			const expired = await db
				.selectFrom("ai_insights")
				.selectAll()
				.where("site_id", "=", siteId)
				.where("range", "=", range)
				.orderBy("created_at", "desc")
				.execute();

			if (expired.length > 0) {
				return c.json({ data: buildResponse(expired, range), success: true });
			}
			return c.json({
				data: emptyResponse(range),
				success: true,
				message: "Insights generation rate-limited. Try again later.",
			});
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

	const planCheck = await requirePlan(db, userId, 2);
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

	try {
		const data = await aggregateData(db, siteId, startIso);
		const rawInsights = await callWorkersAI(c.env?.AI, data, range);

		const now = new Date();
		const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
		const createdAt = now.toISOString();

		// Cache each insight row
		for (const insight of rawInsights) {
			const id = generateId();
			await db
				.insertInto("ai_insights")
				.values({
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
				})
				.execute();
		}

		return {
			insights: rawInsights.map((r, i) => ({
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
			},
		};
	} catch (err) {
		console.error("Insight generation failed:", err);

		// Try returning expired cache as fallback
		const fallback = await db
			.selectFrom("ai_insights")
			.selectAll()
			.where("site_id", "=", siteId)
			.where("range", "=", range)
			.orderBy("created_at", "desc")
			.execute();

		if (fallback.length > 0) {
			return buildResponse(fallback, range);
		}

		return emptyResponse(range);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
	let dataSummary = { total_events: 0, total_revenue: 0, date_range: range };
	if (dataRefs) {
		try {
			const d: { totalEvents?: number; totalRevenue?: number } = JSON.parse(dataRefs);
			dataSummary = {
				total_events: d.totalEvents ?? 0,
				total_revenue: d.totalRevenue ?? 0,
				date_range: range,
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

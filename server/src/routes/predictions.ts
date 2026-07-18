import { type Context, Hono } from "hono";
import type { Kysely } from "kysely";
import type {
	KlikapaDatabase,
	PredictionResponse,
	RevenuePrediction,
} from "shared";
import { sql } from "../db";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type AiBinding = {
	run: (
		model: string,
		input: { prompt: string },
	) => Promise<{ response: string }>;
};
type Env = {
	Bindings: { DB: D1Database; AI?: AiBinding };
	Variables: Variables;
};

export const predictionsRoutes = new Hono<Env>();

function validateSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
) {
	return db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.where("site_id", "=", siteId)
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null),
				),
			]),
		)
		.executeTakeFirst();
}

interface VisitorAgg {
	visitor_id: string;
	total_sessions: number;
	total_pageviews: number;
	total_revenue: number;
	avg_revenue_per_session: number;
	days_active: number;
	device_type: string | null;
	country: string | null;
}

async function aggregateVisitorData(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
): Promise<VisitorAgg[]> {
	const thirtyDaysAgo = startIso;

	// Get per-visitor stats from visitor_profiles joined with events
	const rows = await db
		.selectFrom("visitor_profiles")
		.select([
			"visitor_id",
			"total_sessions",
			"total_pageviews",
			"total_revenue",
			"device_type",
			"country",
		])
		.where("site_id", "=", siteId)
		.where("last_seen", ">=", thirtyDaysAgo)
		.orderBy("total_revenue", "desc")
		.limit(50)
		.execute();

	// Get days_active and avg_revenue_per_session from events
	const eventStats = await db
		.selectFrom("events")
		.select([
			"visitor_id",
			({ fn }) => fn.count<number>("id").distinct().as("session_count"),
			({ fn }) => fn.sum<number>("revenue").as("event_revenue"),
			({ fn }) =>
				fn
					.count<number>(sql`DISTINCT DATE(${sql.ref("timestamp")})`)
					.as("days_active"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", thirtyDaysAgo)
		.groupBy("visitor_id")
		.execute();

	const eventMap = new Map(eventStats.map((r) => [r.visitor_id, r]));

	return rows.map((r) => {
		const ev = eventMap.get(r.visitor_id);
		const sessions = ev ? Number(ev.session_count) : r.total_sessions;
		const revenue = Number(r.total_revenue);
		return {
			visitor_id: r.visitor_id,
			total_sessions: sessions,
			total_pageviews: r.total_pageviews,
			total_revenue: revenue,
			avg_revenue_per_session:
				sessions > 0 ? Math.round((revenue / sessions) * 100) / 100 : 0,
			days_active: ev ? Number(ev.days_active) : 1,
			device_type: r.device_type,
			country: r.country,
		};
	});
}

async function callWorkersAI(
	ai: AiBinding | undefined,
	visitors: VisitorAgg[],
): Promise<RevenuePrediction[]> {
	const visitorData = visitors.map((v) => ({
		visitor_id: v.visitor_id,
		total_sessions: v.total_sessions,
		total_pageviews: v.total_pageviews,
		total_revenue: v.total_revenue,
		avg_revenue_per_session: v.avg_revenue_per_session,
		days_active: v.days_active,
		device_type: v.device_type ?? "unknown",
		country: v.country ?? "unknown",
	}));

	const prompt = `You are a revenue analytics expert. Analyze the following visitor data and predict each visitor's conversion probability (0-100) and predicted future revenue (predicted_ltv).

VISITOR DATA (last 30 days):
${JSON.stringify(visitorData, null, 2)}

For each visitor, consider:
- Higher total_sessions and days_active = higher engagement = higher conversion probability
- Higher total_revenue and avg_revenue_per_session = proven buyer = higher conversion probability
- More pageviews = more interest = higher conversion probability
- Repeat visitors with revenue history are most likely to convert again

Return a JSON array of objects with these fields:
- visitor_id: string (exact match from input)
- conversion_probability: number 0-100 (likelihood of converting in next 30 days)
- predicted_revenue: number (predicted revenue in next 30 days)
- factors: array of 2-3 short strings explaining the key factors

Return ONLY the JSON array, no other text.`;

	if (!ai) return generateFallbackPredictions(visitors);

	try {
		const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", { prompt });
		const text = result?.response ?? "";

		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return generateFallbackPredictions(visitors);

		const parsed = JSON.parse(jsonMatch[0]) as RevenuePrediction[];
		return parsed.slice(0, 50);
	} catch (err) {
		console.error("Workers AI prediction error:", err);
		return generateFallbackPredictions(visitors);
	}
}

function generateFallbackPredictions(
	visitors: VisitorAgg[],
): RevenuePrediction[] {
	const maxRevenue = Math.max(...visitors.map((v) => v.total_revenue), 1);

	return visitors.map((v) => {
		const revenueScore = (v.total_revenue / maxRevenue) * 40;
		const engagementScore = Math.min((v.total_sessions / 10) * 20, 20);
		const activityScore = Math.min((v.days_active / 7) * 20, 20);
		const pageviewScore = Math.min((v.total_pageviews / 30) * 20, 20);
		const rawProbability =
			revenueScore + engagementScore + activityScore + pageviewScore;
		const conversion_probability = Math.round(Math.min(rawProbability, 100));
		const predicted_revenue =
			Math.round(v.total_revenue * (conversion_probability / 100) * 100) / 100;

		const factors: string[] = [];
		if (v.total_revenue > 0)
			factors.push(`Has generated $${v.total_revenue.toFixed(2)} in revenue`);
		if (v.days_active > 3)
			factors.push(`Active ${v.days_active} days in last 30`);
		if (v.total_sessions > 5)
			factors.push(`${v.total_sessions} sessions indicates high engagement`);

		return {
			visitor_id: v.visitor_id,
			conversion_probability,
			predicted_revenue,
			factors: factors.length > 0 ? factors : ["New visitor with limited data"],
		};
	});
}

async function generatePredictions(
	c: Context<Env>,
	db: Kysely<KlikapaDatabase>,
	siteId: string,
): Promise<PredictionResponse> {
	const thirtyDaysAgo = new Date(
		Date.now() - 30 * 24 * 60 * 60 * 1000,
	).toISOString();

	const visitors = await aggregateVisitorData(db, siteId, thirtyDaysAgo);

	if (visitors.length === 0) {
		return {
			predictions: [],
			model_version: "fallback-v1",
			generated_at: new Date().toISOString(),
		};
	}

	const predictions = await callWorkersAI(c.env?.AI, visitors);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour cache
	const createdAt = now.toISOString();

	// Cache in ai_insights table
	await db
		.insertInto("ai_insights")
		.values({
			id: generateId(),
			site_id: siteId,
			range: "30d",
			insight_type: "revenue_prediction",
			insight_text: JSON.stringify(predictions),
			data_refs: null,
			confidence:
				predictions.length > 0
					? Math.round(
							predictions.reduce(
								(sum, p) => sum + p.conversion_probability,
								0,
							) / predictions.length,
						) / 100
					: 0,
			created_at: createdAt,
			expires_at: expiresAt,
		})
		.execute();

	return {
		predictions,
		model_version: c.env?.AI ? "llama-3.1-8b" : "fallback-v1",
		generated_at: createdAt,
	};
}

// GET /predictions
predictionsRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");

	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const now = new Date().toISOString();

	// Check for non-expired cached predictions
	const cached = await db
		.selectFrom("ai_insights")
		.selectAll()
		.where("site_id", "=", siteId)
		.where("insight_type", "=", "revenue_prediction")
		.where("expires_at", ">", now)
		.orderBy("created_at", "desc")
		.limit(1)
		.executeTakeFirst();

	if (cached) {
		let predictions: RevenuePrediction[] = [];
		try {
			predictions = JSON.parse(cached.insight_text ?? "[]");
		} catch {
			/* keep empty */
		}

		return c.json({
			data: {
				predictions,
				model_version: "cached",
				generated_at: cached.created_at,
			},
			success: true,
		});
	}

	// Generate fresh predictions
	const result = await generatePredictions(c, db, siteId);
	return c.json({ data: result, success: true });
});

// POST /predictions/refresh
predictionsRoutes.post("/refresh", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");

	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	// Delete cached predictions for this site
	await db
		.deleteFrom("ai_insights")
		.where("site_id", "=", siteId)
		.where("insight_type", "=", "revenue_prediction")
		.execute();

	// Generate fresh predictions
	const result = await generatePredictions(c, db, siteId);
	return c.json({ data: result, success: true });
});

export default predictionsRoutes;

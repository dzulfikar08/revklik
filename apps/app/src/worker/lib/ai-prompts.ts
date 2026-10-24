/**
 * AI insight generation: data aggregation, prompt building, and fallback logic.
 *
 * Extracted from routes/ai-insights.ts to keep the route file focused on
 * HTTP handling, caching, and orchestration.
 */

import type { Kysely } from "kysely";
import type { InsightType, KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { type MoneyContext, USD_MONEY, revenueSql } from "./fx";
import { canonicalSource } from "./source-sql";

// ---------------------------------------------------------------------------
// Aggregated data types
// ---------------------------------------------------------------------------

export interface AggregatedData {
	revenueBySource: Array<{
		utm_source: string;
		revenue: number;
		visitors: number;
	}>;
	revenueByCountry: Array<{
		country: string;
		revenue: number;
		visitors: number;
	}>;
	funnelDropoff: Array<{
		section: string;
		visitors: number;
		percentage: number;
		dropoff: number;
	}>;
	topPagesByConversion: Array<{
		path: string;
		pageviews: number;
		conversions: number;
		convRate: number;
	}>;
	scrollVsConversion: Array<{
		depth_bucket: string;
		visitors: number;
		conversions: number;
	}>;
	sessionDistribution: Array<{ bucket: string; count: number }>;
	totalEvents: number;
	totalRevenue: number;
	/** ISO 4217 code every revenue figure above is converted into. */
	currency: string;
}

const moneyFormats = new Map<string, Intl.NumberFormat>();
const NBSP = "\u00a0";

const usdFormat = (): Intl.NumberFormat =>
	new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });

/**
 * Whole-unit money in `currency`, matching the dashboard's `money()`:
 * IDR uses id-ID grouping ("Rp 5.504.000"), everything else en-US ("$232").
 * Non-breaking spaces become plain ones so prompts and stored text stay simple.
 */
export function formatMoney(amount: number, currency: string): string {
	const code = currency.toUpperCase();
	let f = moneyFormats.get(code);
	if (!f) {
		try {
			f = new Intl.NumberFormat(code === "IDR" ? "id-ID" : "en-US", {
				currency: code,
				maximumFractionDigits: 0,
				minimumFractionDigits: 0,
				style: "currency",
			});
		} catch {
			f = usdFormat();
		}
		moneyFormats.set(code, f);
	}
	return f.format(Math.round(amount)).replaceAll(NBSP, " ");
}

// ---------------------------------------------------------------------------
// Data aggregation
// ---------------------------------------------------------------------------

export async function aggregateData(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	money: MoneyContext = USD_MONEY,
): Promise<AggregatedData> {
	// Revenue sums are converted into the site's display currency the same
	// way the dashboard does, so insight amounts match the KPI tiles.
	const revenue = revenueSql(money);
	const [
		revenueBySource,
		revenueByCountry,
		totalVisitorsRow,
		scrollDepthRows,
		conversionDepthRows,
		topPagesRaw,
		sessionDistRows,
		totalsRow,
	] = await Promise.all([
		// 1. Revenue by UTM source
		db
			.selectFrom("events")
			.select([
				({ fn }) =>
					fn.coalesce(canonicalSource(sql.ref("utm_source")), sql.lit("direct")).as("utm_source"),
				sql<number>`SUM(${revenue})`.as("revenue"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", "!=", 0)
			.where("timestamp", ">=", startIso)
			.groupBy(({ fn }) => fn.coalesce(canonicalSource(sql.ref("utm_source")), sql.lit("direct")))
			.orderBy("revenue", "desc")
			.limit(10)
			.execute(),

		// 2. Revenue by country
		db
			.selectFrom("events")
			.select([
				({ fn }) => fn.coalesce("country", sql.lit("unknown")).as("country"),
				sql<number>`SUM(${revenue})`.as("revenue"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", "!=", 0)
			.where("timestamp", ">=", startIso)
			.groupBy(({ fn }) => fn.coalesce("country", sql.lit("unknown")))
			.orderBy("revenue", "desc")
			.limit(10)
			.execute(),

		// 3. Total unique visitors (funnel entry)
		db
			.selectFrom("events")
			.select(({ fn }) => [fn.count<number>("visitor_id").distinct().as("count")])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso)
			.executeTakeFirst(),

		// 4. Scroll depth milestone visitors
		db
			.selectFrom("events")
			.select([({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"), "props"])
			.where("site_id", "=", siteId)
			.where("name", "=", "scroll")
			.where("timestamp", ">=", startIso)
			.groupBy("props")
			.execute(),

		// 5. Conversion events with scroll depth
		db
			.selectFrom("events")
			.select([({ fn }) => fn.count<number>("visitor_id").distinct().as("conversions"), "props"])
			.where("site_id", "=", siteId)
			.where("event_type", "=", "conversion")
			.where("timestamp", ">=", startIso)
			.groupBy("props")
			.execute(),

		// 6. Top pages by conversion rate
		db
			.selectFrom("events")
			.select([
				"path",
				({ fn }) => fn.count<number>("id").as("pageviews"),
				({ fn }) =>
					fn
						.sum<number>(sql`CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END`)
						.as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("event_type", "=", "pageview")
			.where("timestamp", ">=", startIso)
			.groupBy("path")
			.orderBy("pageviews", "desc")
			.limit(15)
			.execute(),

		// 7. Session count distribution (page_count buckets)
		db
			.selectFrom("sessions")
			.select([({ fn }) => fn.count<number>("id").as("count"), "page_count"])
			.where("site_id", "=", siteId)
			.where("started_at", ">=", startIso)
			.groupBy("page_count")
			.orderBy("page_count", "asc")
			.execute(),

		// 8. Total events + total revenue. Same expression as the dashboard KPI
		// (getOverviewStats): refunds/negative rows are excluded there too.
		db
			.selectFrom("events")
			.select([
				({ fn }) => fn.count<number>("id").as("total_events"),
				sql<number>`COALESCE(SUM(CASE WHEN revenue != 0 THEN ${revenue} END), 0)`.as(
					"total_revenue",
				),
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso)
			.executeTakeFirst(),
	]);

	const total = Number(totalVisitorsRow?.count ?? 0);

	// Parse scroll depth into funnel steps
	const depthVisitors: Record<string, number> = {};
	for (const row of scrollDepthRows) {
		try {
			const p = JSON.parse(row.props ?? "{}");
			if (p.depth) depthVisitors[String(p.depth)] = Number(row.visitors);
		} catch {
			/* skip */
		}
	}

	const milestones = [25, 50, 75, 90]
		.filter((d) => depthVisitors[String(d)] !== undefined)
		.map((d, i, arr) => {
			const visitors = depthVisitors[String(d)] ?? 0;
			const prevKey = arr[i - 1] !== undefined ? String(arr[i - 1]) : null;
			const prevVisitors = i === 0 ? total : prevKey ? (depthVisitors[prevKey] ?? total) : total;
			return {
				section: `${d}%`,
				visitors,
				percentage: total > 0 ? Math.round((visitors / total) * 100) : 0,
				dropoff:
					i > 0 && prevVisitors > 0
						? Math.round(((prevVisitors - visitors) / prevVisitors) * 100)
						: 0,
			};
		});

	// Parse scroll depth vs conversion correlation
	const scrollVsConversion: Array<{
		depth_bucket: string;
		visitors: number;
		conversions: number;
	}> = [];
	const depthBuckets: Record<string, { visitors: number; conversions: number }> = {};
	for (const row of scrollDepthRows) {
		try {
			const p = JSON.parse(row.props ?? "{}");
			if (p.depth != null) {
				const bucket =
					Number(p.depth) <= 25
						? "0-25"
						: Number(p.depth) <= 50
							? "26-50"
							: Number(p.depth) <= 75
								? "51-75"
								: "76-100";
				if (!depthBuckets[bucket]) depthBuckets[bucket] = { visitors: 0, conversions: 0 };
				depthBuckets[bucket].visitors += Number(row.visitors);
			}
		} catch {
			/* skip */
		}
	}
	for (const row of conversionDepthRows) {
		try {
			const p = JSON.parse(row.props ?? "{}");
			if (p.depth != null) {
				const bucket =
					Number(p.depth) <= 25
						? "0-25"
						: Number(p.depth) <= 50
							? "26-50"
							: Number(p.depth) <= 75
								? "51-75"
								: "76-100";
				if (!depthBuckets[bucket]) depthBuckets[bucket] = { visitors: 0, conversions: 0 };
				depthBuckets[bucket].conversions += Number(row.conversions);
			}
		} catch {
			/* skip */
		}
	}
	for (const [bucket, data] of Object.entries(depthBuckets)) {
		scrollVsConversion.push({ depth_bucket: bucket, ...data });
	}

	// Top pages by conversion rate
	const topPagesByConversion = topPagesRaw.map((r) => ({
		path: r.path,
		pageviews: Number(r.pageviews),
		conversions: Number(r.conversions ?? 0),
		convRate:
			Number(r.pageviews) > 0
				? Math.round((Number(r.conversions ?? 0) / Number(r.pageviews)) * 10000) / 100
				: 0,
	}));

	// Session count distribution
	const sessionDistribution = sessionDistRows.map((r) => {
		const pc = Number(r.page_count);
		const bucket = pc === 1 ? "1 (bounce)" : pc <= 3 ? "2-3" : pc <= 7 ? "4-7" : "8+";
		return { bucket, count: Number(r.count) };
	});
	// Merge same buckets
	const mergedSessions: Record<string, number> = {};
	for (const s of sessionDistribution) {
		mergedSessions[s.bucket] = (mergedSessions[s.bucket] ?? 0) + s.count;
	}
	const sessionDistFinal = Object.entries(mergedSessions).map(([bucket, count]) => ({
		bucket,
		count,
	}));

	return {
		revenueBySource: revenueBySource.map((r) => ({
			utm_source: String(r.utm_source),
			revenue: Number(r.revenue),
			visitors: Number(r.visitors),
		})),
		revenueByCountry: revenueByCountry.map((r) => ({
			country: String(r.country),
			revenue: Number(r.revenue),
			visitors: Number(r.visitors),
		})),
		funnelDropoff: milestones,
		topPagesByConversion,
		scrollVsConversion,
		sessionDistribution: sessionDistFinal,
		totalEvents: Number(totalsRow?.total_events ?? 0),
		totalRevenue: Number(totalsRow?.total_revenue ?? 0),
		currency: money.currency,
	};
}

// ---------------------------------------------------------------------------
// AI insight types
// ---------------------------------------------------------------------------

export interface RawInsight {
	type: InsightType;
	title: string;
	summary: string;
	detail: string;
	confidence: number;
	action: string | null;
}

// ---------------------------------------------------------------------------
// AI binding type (mirrors the one in the route file)
// ---------------------------------------------------------------------------

export type AiBinding = {
	run: (model: string, input: { prompt: string }) => Promise<{ response: string }>;
};

// ---------------------------------------------------------------------------
// Prompt building + Workers AI call
// ---------------------------------------------------------------------------

export async function callWorkersAI(
	ai: AiBinding | undefined,
	data: AggregatedData,
	range: string,
): Promise<RawInsight[]> {
	const prompt = `You are a web analytics expert. Analyze the following aggregated website data for the "${range}" period and generate 3-5 actionable insights.

DATA:
- Revenue by UTM Source: ${JSON.stringify(data.revenueBySource)}
- Revenue by Country: ${JSON.stringify(data.revenueByCountry)}
- Funnel Dropoff (scroll depth): ${JSON.stringify(data.funnelDropoff)}
- Top Pages by Conversion Rate: ${JSON.stringify(data.topPagesByConversion)}
- Scroll Depth vs Conversion: ${JSON.stringify(data.scrollVsConversion)}
- Session Distribution: ${JSON.stringify(data.sessionDistribution)}
- Total Events: ${data.totalEvents}, Total Revenue: ${formatMoney(data.totalRevenue, data.currency)}

All revenue figures are in ${data.currency}. Write every amount in ${data.currency} formatted like "${formatMoney(1_234_567, data.currency)}" (whole units, no other currency symbol).

Return a JSON array of 3-5 insight objects. Each insight must have:
- type: one of "revenue_drivers", "geo_opportunities", "funnel_optimization", "traffic_roi"
- title: short title (under 60 chars)
- summary: one-sentence summary
- detail: 2-3 sentences with specific numbers from the data
- confidence: number 0-1 indicating confidence in this insight
- action: specific actionable recommendation (or null if not applicable)

Return ONLY the JSON array, no other text.`;

	if (!ai) return generateFallbackInsights(data);

	try {
		const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", { prompt });
		const text = result?.response ?? "";

		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return generateFallbackInsights(data);

		const parsed = JSON.parse(jsonMatch[0]) as RawInsight[];
		return parsed.slice(0, 5);
	} catch (err) {
		console.error("Workers AI error:", err);
		return generateFallbackInsights(data);
	}
}

// ---------------------------------------------------------------------------
// Rule-based fallback when AI is unavailable
// ---------------------------------------------------------------------------

export function generateFallbackInsights(data: AggregatedData): RawInsight[] {
	const insights: RawInsight[] = [];

	// Revenue driver insight
	if (data.revenueBySource.length > 0) {
		const top = data.revenueBySource[0] ?? { utm_source: "", revenue: 0, visitors: 0 };
		insights.push({
			type: "revenue_drivers",
			title: `Top revenue source: ${top.utm_source}`,
			summary: `${top.utm_source} generates the most revenue at ${formatMoney(top.revenue, data.currency)} from ${top.visitors} unique visitors.`,
			detail: `Out of all traffic sources, ${top.utm_source} drives ${formatMoney(top.revenue, data.currency)} in revenue with ${top.visitors} visitors. This represents the highest revenue concentration and deserves increased investment.`,
			confidence: 0.85,
			action: `Increase budget allocation to ${top.utm_source} campaigns to scale this proven revenue channel.`,
		});
	}

	// Geo opportunity
	if (data.revenueByCountry.length > 1) {
		const top = data.revenueByCountry[0] ?? { country: "", revenue: 0, visitors: 0 };
		insights.push({
			type: "geo_opportunities",
			title: `Revenue concentrated in ${top.country}`,
			summary: `${top.country} accounts for ${formatMoney(top.revenue, data.currency)} in revenue across ${top.visitors} visitors.`,
			detail: `The majority of revenue (${formatMoney(top.revenue, data.currency)}) comes from ${top.country}. Other countries represent untapped opportunities for localization and targeted campaigns.`,
			confidence: 0.75,
			action: `Consider localizing content for top revenue countries and running geo-targeted campaigns in underperforming regions.`,
		});
	}

	// Funnel optimization
	if (data.funnelDropoff.length >= 2) {
		const worstStep = data.funnelDropoff.reduce((worst, step) =>
			step.dropoff > worst.dropoff ? step : worst,
		);
		insights.push({
			type: "funnel_optimization",
			title: `Biggest dropoff at ${worstStep.section}`,
			summary: `${worstStep.dropoff}% of visitors drop off at the ${worstStep.section} scroll depth.`,
			detail: `The scroll funnel shows a ${worstStep.dropoff}% dropoff at ${worstStep.section}, suggesting content at this depth may need improvement. Only ${worstStep.percentage}% of visitors reach this point.`,
			confidence: 0.8,
			action: `Optimize content layout and calls-to-action around the ${worstStep.section} area to reduce dropoff.`,
		});
	}

	// Traffic ROI
	if (data.revenueBySource.length >= 2) {
		const lowPerforming = data.revenueBySource.filter(
			(s) => s.revenue < (data.totalRevenue / data.revenueBySource.length) * 0.5,
		);
		if (lowPerforming.length > 0) {
			insights.push({
				type: "traffic_roi",
				title: "Low-performing traffic sources detected",
				summary: `${lowPerforming.length} source(s) generate below-average revenue per visitor.`,
				detail: `Sources like ${lowPerforming.map((s) => s.utm_source).join(", ")} are underperforming relative to the average revenue distribution. These may need better targeting or landing page optimization.`,
				confidence: 0.7,
				action:
					"Audit low-performing source campaigns for message-to-page alignment and audience targeting.",
			});
		}
	}

	// Session engagement
	const bounceSessions = data.sessionDistribution.find((s) => s.bucket === "1 (bounce)");
	if (bounceSessions) {
		const totalSessions = data.sessionDistribution.reduce((sum, s) => sum + s.count, 0);
		const bounceRate =
			totalSessions > 0 ? Math.round((bounceSessions.count / totalSessions) * 100) : 0;
		if (bounceRate > 40) {
			insights.push({
				type: "funnel_optimization",
				title: `High bounce rate: ${bounceRate}%`,
				summary: `${bounceRate}% of sessions are single-page bounces, indicating potential landing page issues.`,
				detail: `Out of ${totalSessions} sessions, ${bounceSessions.count} (${bounceRate}%) are single-page visits. This suggests landing pages may not be meeting visitor expectations.`,
				confidence: 0.75,
				action:
					"Improve landing page load speed, headline clarity, and above-the-fold content to reduce bounces.",
			});
		}
	}

	return insights.slice(0, 5);
}

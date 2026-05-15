import { Hono } from "hono";
import { sql } from "../db";
import { generateId, getDateRange } from "../utils";
export const aiInsightsRoutes = new Hono();
function validateSite(db, userId, siteId) {
    return db.selectFrom("sites").select(["id"]).where("id", "=", siteId).where("user_id", "=", userId).executeTakeFirst();
}
/** Cache TTL in hours based on range */
function getCacheTtlHours(range) {
    if (range === "90d")
        return 24;
    if (range === "30d")
        return 12;
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
    if (!siteId)
        return c.json({ error: "site_id required", success: false }, 400);
    const validRanges = ["24h", "7d", "30d", "90d"];
    if (!validRanges.includes(range)) {
        return c.json({ error: "Invalid range. Use 24h, 7d, 30d, or 90d", success: false }, 400);
    }
    const site = await validateSite(db, userId, siteId);
    if (!site)
        return c.json({ error: "Site not found", success: false }, 404);
    const now = new Date().toISOString();
    const ttlHours = getCacheTtlHours(range);
    // Check for non-expired cached insights
    const cached = await db.selectFrom("ai_insights")
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
    const recentCall = await db.selectFrom("ai_insights")
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
            const expired = await db.selectFrom("ai_insights")
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
    const siteId = body.site_id;
    const range = body.range || "7d";
    if (!siteId)
        return c.json({ error: "site_id required", success: false }, 400);
    const validRanges = ["24h", "7d", "30d", "90d"];
    if (!validRanges.includes(range)) {
        return c.json({ error: "Invalid range. Use 24h, 7d, 30d, or 90d", success: false }, 400);
    }
    const site = await validateSite(db, userId, siteId);
    if (!site)
        return c.json({ error: "Site not found", success: false }, 404);
    // Delete cached insights for this site + range
    await db.deleteFrom("ai_insights")
        .where("site_id", "=", siteId)
        .where("range", "=", range)
        .execute();
    const ttlHours = getCacheTtlHours(range);
    const insights = await generateInsights(c, db, siteId, range, ttlHours);
    return c.json({ data: insights, success: true });
});
async function aggregateData(db, siteId, startIso) {
    const [revenueBySource, revenueByCountry, totalVisitorsRow, scrollDepthRows, conversionDepthRows, topPagesRaw, sessionDistRows, totalsRow,] = await Promise.all([
        // 1. Revenue by UTM source
        db.selectFrom("events")
            .select([
            ({ fn }) => fn.coalesce("utm_source", sql.lit("direct")).as("utm_source"),
            ({ fn }) => fn.sum("revenue").as("revenue"),
            ({ fn }) => fn.count("visitor_id").distinct().as("visitors"),
        ])
            .where("site_id", "=", siteId)
            .where("revenue", ">", 0)
            .where("timestamp", ">=", startIso)
            .groupBy(({ fn }) => fn.coalesce("utm_source", sql.lit("direct")))
            .orderBy("revenue", "desc")
            .limit(10)
            .execute(),
        // 2. Revenue by country
        db.selectFrom("events")
            .select([
            ({ fn }) => fn.coalesce("country", sql.lit("unknown")).as("country"),
            ({ fn }) => fn.sum("revenue").as("revenue"),
            ({ fn }) => fn.count("visitor_id").distinct().as("visitors"),
        ])
            .where("site_id", "=", siteId)
            .where("revenue", ">", 0)
            .where("timestamp", ">=", startIso)
            .groupBy(({ fn }) => fn.coalesce("country", sql.lit("unknown")))
            .orderBy("revenue", "desc")
            .limit(10)
            .execute(),
        // 3. Total unique visitors (funnel entry)
        db.selectFrom("events")
            .select(({ fn }) => [fn.count("visitor_id").distinct().as("count")])
            .where("site_id", "=", siteId)
            .where("timestamp", ">=", startIso)
            .executeTakeFirst(),
        // 4. Scroll depth milestone visitors
        db.selectFrom("events")
            .select([
            ({ fn }) => fn.count("visitor_id").distinct().as("visitors"),
            "props",
        ])
            .where("site_id", "=", siteId)
            .where("name", "=", "scroll")
            .where("timestamp", ">=", startIso)
            .groupBy("props")
            .execute(),
        // 5. Conversion events with scroll depth
        db.selectFrom("events")
            .select([
            ({ fn }) => fn.count("visitor_id").distinct().as("conversions"),
            "props",
        ])
            .where("site_id", "=", siteId)
            .where("event_type", "=", "conversion")
            .where("timestamp", ">=", startIso)
            .groupBy("props")
            .execute(),
        // 6. Top pages by conversion rate
        db.selectFrom("events")
            .select([
            "path",
            ({ fn }) => fn.count("id").as("pageviews"),
            ({ fn }) => fn.sum(sql `CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END`).as("conversions"),
        ])
            .where("site_id", "=", siteId)
            .where("event_type", "=", "pageview")
            .where("timestamp", ">=", startIso)
            .groupBy("path")
            .orderBy("pageviews", "desc")
            .limit(15)
            .execute(),
        // 7. Session count distribution (page_count buckets)
        db.selectFrom("sessions")
            .select([
            ({ fn }) => fn.count("id").as("count"),
            "page_count",
        ])
            .where("site_id", "=", siteId)
            .where("started_at", ">=", startIso)
            .groupBy("page_count")
            .orderBy("page_count", "asc")
            .execute(),
        // 8. Total events + total revenue
        db.selectFrom("events")
            .select([
            ({ fn }) => fn.count("id").as("total_events"),
            ({ fn }) => fn.coalesce(({ fn }) => fn.sum("revenue"), sql.lit("0")).as("total_revenue"),
        ])
            .where("site_id", "=", siteId)
            .where("timestamp", ">=", startIso)
            .executeTakeFirst(),
    ]);
    const total = Number(totalVisitorsRow?.count ?? 0);
    // Parse scroll depth into funnel steps
    const depthVisitors = {};
    for (const row of scrollDepthRows) {
        try {
            const p = JSON.parse(row.props ?? "{}");
            if (p.depth)
                depthVisitors[String(p.depth)] = Number(row.visitors);
        }
        catch { /* skip */ }
    }
    const milestones = [25, 50, 75, 90]
        .filter((d) => depthVisitors[String(d)] !== undefined)
        .map((d, i, arr) => {
        const visitors = depthVisitors[String(d)] ?? 0;
        const prevKey = arr[i - 1] !== undefined ? String(arr[i - 1]) : null;
        const prevVisitors = i === 0 ? total : (prevKey ? depthVisitors[prevKey] ?? total : total);
        return {
            section: `${d}%`,
            visitors,
            percentage: total > 0 ? Math.round((visitors / total) * 100) : 0,
            dropoff: i > 0 && prevVisitors > 0 ? Math.round(((prevVisitors - visitors) / prevVisitors) * 100) : 0,
        };
    });
    // Parse scroll depth vs conversion correlation
    const scrollVsConversion = [];
    const depthBuckets = {};
    for (const row of scrollDepthRows) {
        try {
            const p = JSON.parse(row.props ?? "{}");
            if (p.depth != null) {
                const bucket = Number(p.depth) <= 25 ? "0-25" : Number(p.depth) <= 50 ? "26-50" : Number(p.depth) <= 75 ? "51-75" : "76-100";
                if (!depthBuckets[bucket])
                    depthBuckets[bucket] = { visitors: 0, conversions: 0 };
                depthBuckets[bucket].visitors += Number(row.visitors);
            }
        }
        catch { /* skip */ }
    }
    for (const row of conversionDepthRows) {
        try {
            const p = JSON.parse(row.props ?? "{}");
            if (p.depth != null) {
                const bucket = Number(p.depth) <= 25 ? "0-25" : Number(p.depth) <= 50 ? "26-50" : Number(p.depth) <= 75 ? "51-75" : "76-100";
                if (!depthBuckets[bucket])
                    depthBuckets[bucket] = { visitors: 0, conversions: 0 };
                depthBuckets[bucket].conversions += Number(row.conversions);
            }
        }
        catch { /* skip */ }
    }
    for (const [bucket, data] of Object.entries(depthBuckets)) {
        scrollVsConversion.push({ depth_bucket: bucket, ...data });
    }
    // Top pages by conversion rate
    const topPagesByConversion = topPagesRaw.map((r) => ({
        path: r.path,
        pageviews: Number(r.pageviews),
        conversions: Number(r.conversions ?? 0),
        convRate: Number(r.pageviews) > 0 ? Math.round((Number(r.conversions ?? 0) / Number(r.pageviews)) * 10000) / 100 : 0,
    }));
    // Session count distribution
    const sessionDistribution = sessionDistRows.map((r) => {
        const pc = Number(r.page_count);
        const bucket = pc === 1 ? "1 (bounce)" : pc <= 3 ? "2-3" : pc <= 7 ? "4-7" : "8+";
        return { bucket, count: Number(r.count) };
    });
    // Merge same buckets
    const mergedSessions = {};
    for (const s of sessionDistribution) {
        mergedSessions[s.bucket] = (mergedSessions[s.bucket] ?? 0) + s.count;
    }
    const sessionDistFinal = Object.entries(mergedSessions).map(([bucket, count]) => ({ bucket, count }));
    return {
        revenueBySource: revenueBySource.map((r) => ({ utm_source: String(r.utm_source), revenue: Number(r.revenue), visitors: Number(r.visitors) })),
        revenueByCountry: revenueByCountry.map((r) => ({ country: String(r.country), revenue: Number(r.revenue), visitors: Number(r.visitors) })),
        funnelDropoff: milestones,
        topPagesByConversion,
        scrollVsConversion,
        sessionDistribution: sessionDistFinal,
        totalEvents: Number(totalsRow?.total_events ?? 0),
        totalRevenue: Number(totalsRow?.total_revenue ?? 0),
    };
}
async function callWorkersAI(ai, data, range) {
    const prompt = `You are a web analytics expert. Analyze the following aggregated website data for the "${range}" period and generate 3-5 actionable insights.

DATA:
- Revenue by UTM Source: ${JSON.stringify(data.revenueBySource)}
- Revenue by Country: ${JSON.stringify(data.revenueByCountry)}
- Funnel Dropoff (scroll depth): ${JSON.stringify(data.funnelDropoff)}
- Top Pages by Conversion Rate: ${JSON.stringify(data.topPagesByConversion)}
- Scroll Depth vs Conversion: ${JSON.stringify(data.scrollVsConversion)}
- Session Distribution: ${JSON.stringify(data.sessionDistribution)}
- Total Events: ${data.totalEvents}, Total Revenue: ${data.totalRevenue}

Return a JSON array of 3-5 insight objects. Each insight must have:
- type: one of "revenue_drivers", "geo_opportunities", "funnel_optimization", "traffic_roi"
- title: short title (under 60 chars)
- summary: one-sentence summary
- detail: 2-3 sentences with specific numbers from the data
- confidence: number 0-1 indicating confidence in this insight
- action: specific actionable recommendation (or null if not applicable)

Return ONLY the JSON array, no other text.`;
    if (!ai)
        return generateFallbackInsights(data);
    try {
        const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", { prompt });
        const text = result?.response ?? "";
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch)
            return generateFallbackInsights(data);
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.slice(0, 5);
    }
    catch (err) {
        console.error("Workers AI error:", err);
        return generateFallbackInsights(data);
    }
}
/** Rule-based fallback when API is unavailable */
function generateFallbackInsights(data) {
    const insights = [];
    // Revenue driver insight
    if (data.revenueBySource.length > 0) {
        const top = data.revenueBySource[0];
        insights.push({
            type: "revenue_drivers",
            title: `Top revenue source: ${top.utm_source}`,
            summary: `${top.utm_source} generates the most revenue at $${top.revenue.toFixed(2)} from ${top.visitors} unique visitors.`,
            detail: `Out of all traffic sources, ${top.utm_source} drives $${top.revenue.toFixed(2)} in revenue with ${top.visitors} visitors. This represents the highest revenue concentration and deserves increased investment.`,
            confidence: 0.85,
            action: `Increase budget allocation to ${top.utm_source} campaigns to scale this proven revenue channel.`,
        });
    }
    // Geo opportunity
    if (data.revenueByCountry.length > 1) {
        const top = data.revenueByCountry[0];
        insights.push({
            type: "geo_opportunities",
            title: `Revenue concentrated in ${top.country}`,
            summary: `${top.country} accounts for $${top.revenue.toFixed(2)} in revenue across ${top.visitors} visitors.`,
            detail: `The majority of revenue ($${top.revenue.toFixed(2)}) comes from ${top.country}. Other countries represent untapped opportunities for localization and targeted campaigns.`,
            confidence: 0.75,
            action: `Consider localizing content for top revenue countries and running geo-targeted campaigns in underperforming regions.`,
        });
    }
    // Funnel optimization
    if (data.funnelDropoff.length >= 2) {
        const worstStep = data.funnelDropoff.reduce((worst, step) => step.dropoff > worst.dropoff ? step : worst);
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
        const lowPerforming = data.revenueBySource.filter((s) => s.revenue < (data.totalRevenue / data.revenueBySource.length) * 0.5);
        if (lowPerforming.length > 0) {
            insights.push({
                type: "traffic_roi",
                title: "Low-performing traffic sources detected",
                summary: `${lowPerforming.length} source(s) generate below-average revenue per visitor.`,
                detail: `Sources like ${lowPerforming.map((s) => s.utm_source).join(", ")} are underperforming relative to the average revenue distribution. These may need better targeting or landing page optimization.`,
                confidence: 0.7,
                action: "Audit low-performing source campaigns for message-to-page alignment and audience targeting.",
            });
        }
    }
    // Session engagement
    const bounceSessions = data.sessionDistribution.find((s) => s.bucket === "1 (bounce)");
    if (bounceSessions) {
        const totalSessions = data.sessionDistribution.reduce((sum, s) => sum + s.count, 0);
        const bounceRate = totalSessions > 0 ? Math.round((bounceSessions.count / totalSessions) * 100) : 0;
        if (bounceRate > 40) {
            insights.push({
                type: "funnel_optimization",
                title: `High bounce rate: ${bounceRate}%`,
                summary: `${bounceRate}% of sessions are single-page bounces, indicating potential landing page issues.`,
                detail: `Out of ${totalSessions} sessions, ${bounceSessions.count} (${bounceRate}%) are single-page visits. This suggests landing pages may not be meeting visitor expectations.`,
                confidence: 0.75,
                action: "Improve landing page load speed, headline clarity, and above-the-fold content to reduce bounces.",
            });
        }
    }
    return insights.slice(0, 5);
}
// ---------------------------------------------------------------------------
// Orchestrate generation: aggregate -> AI -> cache -> response
// ---------------------------------------------------------------------------
async function generateInsights(c, db, siteId, range, ttlHours) {
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
            await db.insertInto("ai_insights").values({
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
            }).execute();
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
    }
    catch (err) {
        console.error("Insight generation failed:", err);
        // Try returning expired cache as fallback
        const fallback = await db.selectFrom("ai_insights")
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
function buildResponse(rows, range) {
    const insights = rows.map((r, i) => {
        let parsed = {};
        try {
            parsed = JSON.parse(r.insight_text ?? "{}");
        }
        catch { /* keep empty */ }
        return {
            id: r.id ?? `${i}`,
            type: r.insight_type ?? "revenue_drivers",
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
            const d = JSON.parse(dataRefs);
            dataSummary = { total_events: d.totalEvents ?? 0, total_revenue: d.totalRevenue ?? 0, date_range: range };
        }
        catch { /* keep default */ }
    }
    return {
        insights,
        generated_at: rows[0]?.created_at ?? new Date().toISOString(),
        data_summary: dataSummary,
    };
}
function emptyResponse(range) {
    return {
        insights: [],
        generated_at: new Date().toISOString(),
        data_summary: { total_events: 0, total_revenue: 0, date_range: range },
    };
}

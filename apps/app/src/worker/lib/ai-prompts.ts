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
import { revenueTotalSql, visitorsSql } from "./metrics";
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

		// 3. Total unique visitors (funnel entry): the dashboard's visitor definition
		db
			.selectFrom("events")
			.select(visitorsSql().as("count"))
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

		// 8. Total events + total revenue: the dashboard KPI definition (lib/metrics.ts).
		db
			.selectFrom("events")
			.select([
				({ fn }) => fn.count<number>("id").as("total_events"),
				revenueTotalSql(money).as("total_revenue"),
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

/** Language insight text is written in. */
export type InsightLang = "en" | "id";

export const parseInsightLang = (value: unknown): InsightLang => (value === "id" ? "id" : "en");

const LANGUAGE_RULE: Record<InsightLang, string> = {
	en: "Write title, summary, detail and action in English.",
	id: 'Write title, summary, detail and action in Bahasa Indonesia: plain, polite, addressing the reader as "kamu", no slang. Keep the JSON keys and the "type" values exactly as listed, in English.',
};

export async function callWorkersAI(
	ai: AiBinding | undefined,
	data: AggregatedData,
	range: string,
	lang: InsightLang = "en",
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

${LANGUAGE_RULE[lang]}

Return ONLY the JSON array, no other text.`;

	if (!ai) return generateFallbackInsights(data, lang);

	try {
		const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", { prompt });
		const text = result?.response ?? "";

		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return generateFallbackInsights(data, lang);

		const parsed = JSON.parse(jsonMatch[0]) as RawInsight[];
		return parsed.slice(0, 5);
	} catch (err) {
		console.error("Workers AI error:", err);
		return generateFallbackInsights(data, lang);
	}
}

// ---------------------------------------------------------------------------
// Rule-based fallback when AI is unavailable
// ---------------------------------------------------------------------------

type FallbackCopy = {
	revenueTitle: (source: string) => string;
	revenueSummary: (source: string, money: string, visitors: number) => string;
	revenueDetail: (source: string, share: number) => string;
	revenueAction: (source: string) => string;
	geoTitle: (country: string) => string;
	geoSummary: (country: string, money: string, visitors: number) => string;
	geoDetail: (country: string, share: number) => string;
	geoAction: string;
	funnelTitle: (section: string) => string;
	funnelSummary: (section: string, dropoff: number) => string;
	funnelDetail: (section: string, dropoff: number, reach: number) => string;
	funnelAction: (section: string) => string;
	lowTitle: string;
	lowSummary: (n: number) => string;
	lowDetail: (sources: string) => string;
	lowAction: string;
	bounceTitle: (rate: number) => string;
	bounceSummary: (rate: number) => string;
	bounceDetail: (sessions: number, bounces: number, rate: number) => string;
	bounceAction: string;
};

const FALLBACK_COPY: Record<InsightLang, FallbackCopy> = {
	en: {
		revenueTitle: (source) => `Top revenue source: ${source}`,
		revenueSummary: (source, money, visitors) =>
			`${source} brought in ${money} from ${visitors} visitors.`,
		revenueDetail: (source, share) =>
			`${source} is ${share}% of the revenue in this period, more than any other source.`,
		revenueAction: (source) =>
			`Keep showing up where ${source} comes from: it is the channel already paying you.`,
		geoTitle: (country) => `Most revenue comes from ${country}`,
		geoSummary: (country, money, visitors) =>
			`${country} accounts for ${money} across ${visitors} visitors.`,
		geoDetail: (country, share) =>
			`${country} is ${share}% of the revenue in this period. Check whether your price, language and payment methods fit the next-biggest countries too.`,
		geoAction:
			"Look at the pages and payment methods your top country uses, then test them on the next country.",
		funnelTitle: (section) => `Most visitors stop at ${section} scroll depth`,
		funnelSummary: (section, dropoff) =>
			`${dropoff}% of visitors who reached the previous point leave before ${section}.`,
		funnelDetail: (section, dropoff, reach) =>
			`The scroll funnel loses ${dropoff}% of visitors at ${section}, and only ${reach}% of all visitors get that far.`,
		funnelAction: (section) =>
			`Move your main call to action above the ${section} line, or tighten what sits just before it.`,
		lowTitle: "Some sources bring little revenue",
		lowSummary: (n) => `${n} source(s) earn well under the average per source.`,
		lowDetail: (sources) =>
			`${sources} earn well under the average source. They may bring visitors who are not your buyers.`,
		lowAction:
			"Check whether the message that brings these visitors matches the page they land on.",
		bounceTitle: (rate) => `${rate}% of sessions are a single page`,
		bounceSummary: (rate) => `${rate}% of sessions leave after one page.`,
		bounceDetail: (sessions, bounces, rate) =>
			`Out of ${sessions} sessions, ${bounces} (${rate}%) ended on the first page.`,
		bounceAction:
			"Read your top landing page as a stranger would: is it clear in five seconds what you sell and for how much?",
	},
	id: {
		revenueTitle: (source) => `Sumber pendapatan terbesar: ${source}`,
		revenueSummary: (source, money, visitors) =>
			`${source} membawa ${money} dari ${visitors} pengunjung.`,
		revenueDetail: (source, share) =>
			`${source} menyumbang ${share}% pendapatan di periode ini, lebih besar dari sumber lain.`,
		revenueAction: (source) =>
			`Tetap aktif di tempat asal ${source}: itu kanal yang sudah terbukti membayar.`,
		geoTitle: (country) => `Pendapatan terbanyak dari ${country}`,
		geoSummary: (country, money, visitors) =>
			`${country} menyumbang ${money} dari ${visitors} pengunjung.`,
		geoDetail: (country, share) =>
			`${country} menyumbang ${share}% pendapatan di periode ini. Cek apakah harga, bahasa, dan metode pembayaranmu juga cocok untuk negara berikutnya.`,
		geoAction:
			"Lihat halaman dan metode pembayaran yang dipakai negara teratasmu, lalu coba di negara berikutnya.",
		funnelTitle: (section) => `Banyak pengunjung berhenti di kedalaman scroll ${section}`,
		funnelSummary: (section, dropoff) =>
			`${dropoff}% pengunjung yang sampai titik sebelumnya pergi sebelum ${section}.`,
		funnelDetail: (section, dropoff, reach) =>
			`Funnel scroll kehilangan ${dropoff}% pengunjung di ${section}, dan hanya ${reach}% dari semua pengunjung sampai sejauh itu.`,
		funnelAction: (section) =>
			`Pindahkan ajakan utamamu ke atas garis ${section}, atau ringkas bagian tepat sebelumnya.`,
		lowTitle: "Beberapa sumber membawa sedikit pendapatan",
		lowSummary: (n) => `${n} sumber menghasilkan jauh di bawah rata-rata per sumber.`,
		lowDetail: (sources) =>
			`${sources} menghasilkan jauh di bawah rata-rata. Bisa jadi pengunjung dari sana bukan calon pembelimu.`,
		lowAction:
			"Cek apakah pesan yang membawa pengunjung ini cocok dengan halaman yang mereka datangi.",
		bounceTitle: (rate) => `${rate}% sesi hanya satu halaman`,
		bounceSummary: (rate) => `${rate}% sesi pergi setelah satu halaman.`,
		bounceDetail: (sessions, bounces, rate) =>
			`Dari ${sessions} sesi, ${bounces} (${rate}%) berakhir di halaman pertama.`,
		bounceAction:
			"Baca halaman pendaratan utamamu seperti orang asing: apakah dalam lima detik jelas apa yang kamu jual dan berapa harganya?",
	},
};

export function generateFallbackInsights(
	data: AggregatedData,
	lang: InsightLang = "en",
): RawInsight[] {
	const c = FALLBACK_COPY[lang];
	const insights: RawInsight[] = [];
	const sharePct = (part: number): number =>
		data.totalRevenue > 0 ? Math.round((part / data.totalRevenue) * 100) : 0;

	// Revenue driver insight
	if (data.revenueBySource.length > 0) {
		const top = data.revenueBySource[0] ?? { utm_source: "", revenue: 0, visitors: 0 };
		insights.push({
			type: "revenue_drivers",
			title: c.revenueTitle(top.utm_source),
			summary: c.revenueSummary(
				top.utm_source,
				formatMoney(top.revenue, data.currency),
				top.visitors,
			),
			detail: c.revenueDetail(top.utm_source, sharePct(top.revenue)),
			confidence: 0.85,
			action: c.revenueAction(top.utm_source),
		});
	}

	// Geo opportunity
	if (data.revenueByCountry.length > 1) {
		const top = data.revenueByCountry[0] ?? { country: "", revenue: 0, visitors: 0 };
		insights.push({
			type: "geo_opportunities",
			title: c.geoTitle(top.country),
			summary: c.geoSummary(top.country, formatMoney(top.revenue, data.currency), top.visitors),
			detail: c.geoDetail(top.country, sharePct(top.revenue)),
			confidence: 0.75,
			action: c.geoAction,
		});
	}

	// Funnel optimization
	if (data.funnelDropoff.length >= 2) {
		const worstStep = data.funnelDropoff.reduce((worst, step) =>
			step.dropoff > worst.dropoff ? step : worst,
		);
		insights.push({
			type: "funnel_optimization",
			title: c.funnelTitle(worstStep.section),
			summary: c.funnelSummary(worstStep.section, worstStep.dropoff),
			detail: c.funnelDetail(worstStep.section, worstStep.dropoff, worstStep.percentage),
			confidence: 0.8,
			action: c.funnelAction(worstStep.section),
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
				title: c.lowTitle,
				summary: c.lowSummary(lowPerforming.length),
				detail: c.lowDetail(lowPerforming.map((s) => s.utm_source).join(", ")),
				confidence: 0.7,
				action: c.lowAction,
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
				title: c.bounceTitle(bounceRate),
				summary: c.bounceSummary(bounceRate),
				detail: c.bounceDetail(totalSessions, bounceSessions.count, bounceRate),
				confidence: 0.75,
				action: c.bounceAction,
			});
		}
	}

	return insights.slice(0, 5);
}

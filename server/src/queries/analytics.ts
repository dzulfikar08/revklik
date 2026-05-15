import type { KlikapaDatabase, StatsResponse, TimeSeriesPoint, TopPage, SourceEntry, DeviceEntry, RevenueBySource, RevenueByCountry, RevenueTimeSeriesPoint } from "shared";
import type { Kysely } from "kysely";
import { sql } from "../db";

// Referrer source SQL: extracts hostname from referrer URL and normalizes known social/referral domains.
// This is used in getReferrers and getRevenueBySource so both display unified source names.
const sourceSql = sql<string>`COALESCE(utm_source,
  CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct'
  WHEN referrer LIKE '%ig_text_post_permalink%' OR referrer LIKE '%ig_text_feed_timeline%' THEN 'instagram'
  ELSE
    CASE LOWER(REPLACE(
        SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
          INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
        'www.', ''))
      WHEN 'l.threads.com' THEN 'threads'
      WHEN 'threads.net' THEN 'threads'
      WHEN 'm.facebook.com' THEN 'facebook'
      WHEN 'facebook.com' THEN 'facebook'
      WHEN 'fb.me' THEN 'facebook'
      WHEN 't.co' THEN 'twitter'
      WHEN 'instagram.com' THEN 'instagram'
      ELSE LOWER(REPLACE(
        SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
          INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
        'www.', ''))
    END
  END)`;

export async function getOverviewStats(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
): Promise<StatsResponse> {
  const [pv, vi, se, bo, rev, conv] = await Promise.all([
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("site_id", "=", siteId).where("event_type", "=", "pageview").where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("visitor_id").distinct().as("count")])
      .where("site_id", "=", siteId).where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("sessions").select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).executeTakeFirst(),
    db.selectFrom("sessions").select(({ fn }) => [fn.avg<number>("is_bounce").as("avg")])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.sum<number>("revenue").as("total")])
      .where("site_id", "=", siteId).where("revenue", ">", 0).where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("site_id", "=", siteId).where("event_type", "=", "conversion").where("timestamp", ">=", startIso).executeTakeFirst(),
  ]);

  return {
    pageviews: Number(pv?.count ?? 0),
    visitors: Number(vi?.count ?? 0),
    sessions: Number(se?.count ?? 0),
    bounceRate: Math.round(Number(bo?.avg ?? 0) * 100),
    avgDuration: 0,
    revenue: Number(rev?.total ?? 0),
    conversions: Number(conv?.count ?? 0),
  };
}

export async function getTimeseries(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
  isHourly: boolean,
): Promise<TimeSeriesPoint[]> {
  const tsDate = isHourly ? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})` : sql<string>`date(${sql.ref("timestamp")})`;
  const tsGroup = isHourly ? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})` : sql`date(${sql.ref("timestamp")})`;

  const tsRows = await db.selectFrom("events").select([
    ({ fn }) => fn.count<number>("id").as("pageviews"),
    ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    tsDate.as("date"),
  ]).where("site_id", "=", siteId).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
    .groupBy(tsGroup).orderBy("date", "asc").execute();

  return tsRows.map((r) => ({
    date: String(r.date ?? ""),
    pageviews: Number(r.pageviews),
    visitors: Number(r.visitors),
  }));
}

export async function getTopPages(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
  limit: number,
): Promise<TopPage[]> {
  const pageRows = await db.selectFrom("events").select(["path", ({ fn }) => fn.count<number>("id").as("pageviews"), ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors")])
    .where("site_id", "=", siteId).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
    .groupBy("path").orderBy("pageviews", "desc").limit(limit).execute();

  return pageRows.map((r) => ({
    path: r.path,
    pageviews: Number(r.pageviews),
    visitors: Number(r.visitors),
  }));
}

export async function getReferrers(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
  limit: number,
): Promise<SourceEntry[]> {
  const sourceRows = await db.selectFrom("events").select([
    sourceSql.as("source"),
    ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
  ]).where("site_id", "=", siteId).where("timestamp", ">=", startIso)
    .groupBy(sourceSql).orderBy("visitors", "desc").limit(limit).execute();

  const totalSrc = sourceRows.reduce((s, r) => s + Number(r.visitors), 0);
  return sourceRows.map((r) => ({
    source: String(r.source),
    visitors: Number(r.visitors),
    percentage: totalSrc > 0 ? Math.round((Number(r.visitors) / totalSrc) * 100) : 0,
  }));
}

export async function getDeviceBreakdown(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
): Promise<{ devices: DeviceEntry[]; os: DeviceEntry[]; browsers: DeviceEntry[] }> {
  const [deviceRows, osRows, browserRows] = await Promise.all([
    db.selectFrom("sessions").select([
      sql<string>`COALESCE(device_type, 'unknown')`.as("device"),
      ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    ]).where("site_id", "=", siteId).where("started_at", ">=", startIso)
      .groupBy("device_type").orderBy("visitors", "desc").limit(10).execute(),
    db.selectFrom("sessions").select([
      sql<string>`COALESCE(os, 'unknown')`.as("device"),
      ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    ]).where("site_id", "=", siteId).where("started_at", ">=", startIso)
      .groupBy("os").orderBy("visitors", "desc").limit(10).execute(),
    db.selectFrom("sessions").select([
      sql<string>`COALESCE(browser, 'unknown')`.as("device"),
      ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    ]).where("site_id", "=", siteId).where("started_at", ">=", startIso)
      .groupBy("browser").orderBy("visitors", "desc").limit(10).execute(),
  ]);

  const totalDev = deviceRows.reduce((s, r) => s + Number(r.visitors), 0);
  const devices: DeviceEntry[] = deviceRows.map((r) => ({
    device: String(r.device), visitors: Number(r.visitors),
    percentage: totalDev > 0 ? Math.round((Number(r.visitors) / totalDev) * 100) : 0,
  }));

  const totalOs = osRows.reduce((s, r) => s + Number(r.visitors), 0);
  const os: DeviceEntry[] = osRows.map((r) => ({
    device: String(r.device), visitors: Number(r.visitors),
    percentage: totalOs > 0 ? Math.round((Number(r.visitors) / totalOs) * 100) : 0,
  }));

  const totalBr = browserRows.reduce((s, r) => s + Number(r.visitors), 0);
  const browsers: DeviceEntry[] = browserRows.map((r) => ({
    device: String(r.device), visitors: Number(r.visitors),
    percentage: totalBr > 0 ? Math.round((Number(r.visitors) / totalBr) * 100) : 0,
  }));

  return { devices, os, browsers };
}

export async function getGeoData(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
  limit: number,
) {
  return db.selectFrom("events")
    .select(["country", "region", "city", ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors")])
    .where("site_id", "=", siteId)
    .where("timestamp", ">=", startIso)
    .groupBy(["country", "region", "city"])
    .orderBy("visitors", "desc")
    .limit(limit)
    .execute();
}

export async function getRevenueBySource(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
): Promise<RevenueBySource[]> {
  const rows = await db.selectFrom("events").select([
    sourceSql.as("source"),
    ({ fn }) => fn.sum<number>("revenue").as("revenue"),
    ({ fn }) => fn.count<number>("id").as("conversions"),
  ]).where("site_id", "=", siteId).where("revenue", ">", 0).where("timestamp", ">=", startIso)
    .groupBy(sourceSql).orderBy("revenue", "desc").limit(10).execute();

  return rows.map((r) => ({
    source: String(r.source),
    revenue: Number(r.revenue ?? 0),
    conversions: Number(r.conversions ?? 0),
  }));
}

export async function getRevenueByCountry(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
): Promise<RevenueByCountry[]> {
  const rows = await db.selectFrom("events").select([
    sql<string>`COALESCE(country, 'unknown')`.as("country"),
    ({ fn }) => fn.sum<number>("revenue").as("revenue"),
    ({ fn }) => fn.count<number>("id").as("conversions"),
  ]).where("site_id", "=", siteId).where("revenue", ">", 0).where("timestamp", ">=", startIso)
    .groupBy("country").orderBy("revenue", "desc").limit(10).execute();

  return rows.map((r) => ({
    country: String(r.country),
    revenue: Number(r.revenue ?? 0),
    conversions: Number(r.conversions ?? 0),
  }));
}

export async function getRevenueTimeseries(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  startIso: string,
  isHourly: boolean,
): Promise<RevenueTimeSeriesPoint[]> {
  const tsDate = isHourly ? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})` : sql<string>`date(${sql.ref("timestamp")})`;
  const tsGroup = isHourly ? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})` : sql`date(${sql.ref("timestamp")})`;

  const rows = await db.selectFrom("events").select([
    tsDate.as("date"),
    ({ fn }) => fn.sum<number>("revenue").as("revenue"),
    ({ fn }) => fn.count<number>("id").as("conversions"),
  ]).where("site_id", "=", siteId).where("revenue", ">", 0).where("timestamp", ">=", startIso)
    .groupBy(tsGroup).orderBy("date", "asc").execute();

  return rows.map((r) => ({
    date: String(r.date ?? ""),
    revenue: Number(r.revenue ?? 0),
    conversions: Number(r.conversions ?? 0),
  }));
}

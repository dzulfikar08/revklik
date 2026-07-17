import { Command } from "commander";
import { getGscQueries, syncGsc, resolveSite, type GscRow } from "../lib/api.js";
import { printJson, printTable, formatNumber } from "../lib/output.js";
import chalk from "chalk";

export const gscCommand = new Command("gsc")
  .description("Google Search Console — search query performance");

const siteOption = (cmd: Command) =>
  cmd.requiredOption("-s, --site <site>", "Site ID or domain");

// revklik gsc queries — top search queries by clicks (aggregated across the stored 30d window)
const queries = gscCommand.command("queries").description("Top search queries (clicks, impressions, CTR, position)");
siteOption(queries);
queries
  .option("-l, --limit <n>", "Top queries to show", "20")
  .action(async (opts: { site: string; limit: string }) => {
    try {
      const siteId = await resolveSite(opts.site);
      const rows = await getGscQueries(siteId);
      const limit = Math.min(Number(opts.limit) || 20, 1000);

      if (opts.json || process.argv.includes("--json")) {
        printJson(rows);
        return;
      }

      if (rows.length === 0) {
        console.log(chalk.yellow("\nNo Search Console data for this site."));
        console.log(chalk.gray("  Either GSC is not connected, or no sync has run."));
        console.log(chalk.gray("  Connect it at: https://app.revklik.com/integrations"));
        console.log(chalk.gray("  Then run: revklik gsc sync --site <site>\n"));
        return;
      }

      // Collapse per-day rows into one row per query.
      const byQuery = new Map<string, { clicks: number; impressions: number; posSum: number; ctrSum: number; n: number; last: string }>();
      const dates: string[] = [];
      for (const r of rows) {
        dates.push(r.date);
        const agg = byQuery.get(r.query) ?? { clicks: 0, impressions: 0, posSum: 0, ctrSum: 0, n: 0, last: r.date };
        agg.clicks += r.clicks;
        agg.impressions += r.impressions;
        agg.posSum += r.position;
        agg.ctrSum += r.ctr;
        agg.n += 1;
        if (r.date > agg.last) agg.last = r.date;
        byQuery.set(r.query, agg);
      }

      const qs = [...byQuery.entries()]
        .map(([query, a]) => ({
          query,
          clicks: a.clicks,
          impressions: a.impressions,
          ctr: a.ctrSum / a.n,          // GSC ctr is already a fraction (0-1)
          position: a.posSum / a.n,
          last: a.last,
        }))
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

      dates.sort();
      const totalClicks = qs.reduce((s, q) => s + q.clicks, 0);
      const totalImpressions = qs.reduce((s, q) => s + q.impressions, 0);
      const avgPosition = qs.length ? qs.reduce((s, q) => s + q.position * q.impressions, 0) / Math.max(totalImpressions, 1) : 0;

      console.log(chalk.bold(`\nGoogle Search Console — ${siteId}`));
      console.log(chalk.gray(`  ${dates[0]} → ${dates[dates.length - 1]} | ${qs.length} queries | ${formatNumber(totalClicks)} clicks | ${formatNumber(totalImpressions)} impressions | avg pos ${avgPosition.toFixed(1)}\n`));

      printTable(
        ["Query", "Clicks", "Impr.", "CTR", "Pos", "Last"],
        qs.slice(0, limit).map((q) => [
          q.query.length > 40 ? q.query.slice(0, 38) + ".." : q.query,
          formatNumber(q.clicks),
          formatNumber(q.impressions),
          `${(q.ctr * 100).toFixed(1)}%`,
          q.position.toFixed(1),
          q.last,
        ])
      );
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

// revklik gsc sync — pull last 7 days of search analytics from Google into revklik
const sync = gscCommand.command("sync").description("Sync recent search data from Google (last 7d)");
siteOption(sync);
sync.action(async (opts: { site: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const result = await syncGsc(siteId);
    console.log(chalk.green(`\nSynced ${formatNumber(result.synced)} search-analytics rows for ${siteId}.`));
    console.log(chalk.gray("  GSC data has a ~2-day delay; run queries again to view.\n"));
  } catch (err: any) {
    console.error(chalk.red(err.message));
    console.error(chalk.gray("  If GSC is not connected, authorize at: https://app.revklik.com/integrations"));
    process.exit(1);
  }
});

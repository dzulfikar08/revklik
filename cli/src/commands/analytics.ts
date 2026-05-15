import { Command } from "commander";
import { getAnalyticsOverview, getAnalyticsTimeseries, getAnalyticsPages, getAnalyticsReferrers, getAnalyticsGeo, getAnalyticsDevices, getAnalyticsRevenue, resolveSite } from "../lib/api.js";
import { printJson, printTable, printOverview, formatNumber, formatCurrency, formatPercent } from "../lib/output.js";
import chalk from "chalk";

export const analyticsCommand = new Command("analytics")
  .description("Query analytics data");

const rangeOption = (cmd: Command) =>
  cmd.option("-r, --range <range>", "Date range (24h, 7d, 30d, 90d)", "7d");
const siteOption = (cmd: Command) =>
  cmd.requiredOption("-s, --site <site>", "Site ID or domain");

// revklik analytics overview
const overview = analyticsCommand.command("overview").description("Analytics overview stats");
siteOption(overview);
rangeOption(overview);
overview.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsOverview(siteId, opts.range);
    printOverview(data, siteId, opts.range);
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

// revklik analytics timeseries
const timeseries = analyticsCommand.command("timeseries").description("Time series data");
siteOption(timeseries);
rangeOption(timeseries);
timeseries.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsTimeseries(siteId, opts.range);
    printTable(
      ["Date", "Pageviews", "Visitors"],
      data.map((r) => [r.date, formatNumber(r.pageviews), formatNumber(r.visitors)])
    );
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

// revklik analytics pages
const pages = analyticsCommand.command("pages").description("Top pages");
siteOption(pages);
rangeOption(pages);
pages.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsPages(siteId, opts.range);
    printTable(
      ["Path", "Pageviews", "Visitors"],
      data.map((r) => [r.path, formatNumber(r.pageviews), formatNumber(r.visitors)])
    );
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

// revklik analytics referrers
const referrers = analyticsCommand.command("referrers").description("Traffic sources");
siteOption(referrers);
rangeOption(referrers);
referrers.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsReferrers(siteId, opts.range);
    printTable(
      ["Source", "Visitors", "%"],
      data.map((r) => [r.source, formatNumber(r.visitors), formatPercent(r.percentage)])
    );
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

// revklik analytics geo
const geo = analyticsCommand.command("geo").description("Geographic breakdown");
siteOption(geo);
rangeOption(geo);
geo.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsGeo(siteId, opts.range);
    printTable(
      ["Country", "Region", "City", "Visitors"],
      data.map((r: any) => [r.country || "-", r.region || "-", r.city || "-", formatNumber(Number(r.visitors))])
    );
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

// revklik analytics devices
const devices = analyticsCommand.command("devices").description("Device breakdown");
siteOption(devices);
rangeOption(devices);
devices.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsDevices(siteId, opts.range);
    console.log(chalk.bold("\nDevices:"));
    printTable(["Device", "Visitors", "%"], data.devices.map((r) => [r.device, formatNumber(r.visitors), formatPercent(r.percentage)]));
    console.log(chalk.bold("\nOS:"));
    printTable(["OS", "Visitors", "%"], data.os.map((r) => [r.device, formatNumber(r.visitors), formatPercent(r.percentage)]));
    console.log(chalk.bold("\nBrowsers:"));
    printTable(["Browser", "Visitors", "%"], data.browsers.map((r) => [r.device, formatNumber(r.visitors), formatPercent(r.percentage)]));
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

// revklik analytics revenue
const revenue = analyticsCommand.command("revenue").description("Revenue breakdown");
siteOption(revenue);
rangeOption(revenue);
revenue.action(async (opts: { site: string; range: string }) => {
  try {
    const siteId = await resolveSite(opts.site);
    const data = await getAnalyticsRevenue(siteId, opts.range);
    console.log(chalk.bold("\nRevenue by Source:"));
    printTable(["Source", "Revenue", "Conversions"], data.bySource.map((r) => [r.source, formatCurrency(r.revenue), formatNumber(r.conversions)]));
    console.log(chalk.bold("\nRevenue by Country:"));
    printTable(["Country", "Revenue", "Conversions"], data.byCountry.map((r) => [r.country, formatCurrency(r.revenue), formatNumber(r.conversions)]));
  } catch (err: any) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
});

import chalk from "chalk";
import { Command } from "commander";
import {
	getAnalyticsDevices,
	getAnalyticsEvents,
	getAnalyticsGeo,
	getAnalyticsJourneys,
	getAnalyticsOverview,
	getAnalyticsPages,
	getAnalyticsReferrers,
	getAnalyticsRevenue,
	getAnalyticsTimeseries,
	resolveSite,
} from "../lib/api.js";
import {
	formatCurrency,
	formatNumber,
	formatPercent,
	printJson,
	printOverview,
	printTable,
} from "../lib/output.js";

export const analyticsCommand = new Command("analytics").description("Query analytics data");

const rangeOption = (cmd: Command) =>
	cmd.option("-r, --range <range>", "Date range (24h, 7d, 30d, 90d)", "7d");
const siteOption = (cmd: Command) => cmd.requiredOption("-s, --site <site>", "Site ID or domain");

// revklik analytics overview
const overview = analyticsCommand.command("overview").description("Analytics overview stats");
siteOption(overview);
rangeOption(overview);
overview.action(async (opts: { site: string; range: string }) => {
	try {
		const siteId = await resolveSite(opts.site);
		const data = await getAnalyticsOverview(siteId, opts.range);
		printOverview(data, siteId, opts.range);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
			data.map((r) => [r.date, formatNumber(r.pageviews), formatNumber(r.visitors)]),
		);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
			data.map((r) => [r.path, formatNumber(r.pageviews), formatNumber(r.visitors)]),
		);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
			data.map((r) => [r.source, formatNumber(r.visitors), formatPercent(r.percentage)]),
		);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
			data.map((r) => [
				r.country || "-",
				r.region || "-",
				r.city || "-",
				formatNumber(Number(r.visitors)),
			]),
		);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
		printTable(
			["Device", "Visitors", "%"],
			data.devices.map((r) => [r.device, formatNumber(r.visitors), formatPercent(r.percentage)]),
		);
		console.log(chalk.bold("\nOS:"));
		printTable(
			["OS", "Visitors", "%"],
			data.os.map((r) => [r.device, formatNumber(r.visitors), formatPercent(r.percentage)]),
		);
		console.log(chalk.bold("\nBrowsers:"));
		printTable(
			["Browser", "Visitors", "%"],
			data.browsers.map((r) => [r.device, formatNumber(r.visitors), formatPercent(r.percentage)]),
		);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
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
		printTable(
			["Source", "Revenue", "Conversions"],
			data.bySource.map((r) => [r.source, formatCurrency(r.revenue), formatNumber(r.conversions)]),
		);
		console.log(chalk.bold("\nRevenue by Country:"));
		printTable(
			["Country", "Revenue", "Conversions"],
			data.byCountry.map((r) => [
				r.country,
				formatCurrency(r.revenue),
				formatNumber(r.conversions),
			]),
		);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
		process.exit(1);
	}
});

// revklik analytics events
const eventsCmd = analyticsCommand.command("events").description("Raw event log");
siteOption(eventsCmd);
rangeOption(eventsCmd);
eventsCmd
	.option("-l, --limit <n>", "Max events to show", "50")
	.option("-t, --type <type>", "Filter by event type (pageview, conversion, custom)", "all")
	.action(
		async (opts: { site: string; range: string; limit: string; type: string; json?: boolean }) => {
			try {
				const siteId = await resolveSite(opts.site);
				const limit = Math.min(Number(opts.limit) || 50, 10000);
				const events = await getAnalyticsEvents(siteId, opts.range, limit, opts.type);

				if (opts.json || process.argv.includes("--json")) {
					printJson(events);
					return;
				}

				console.log(chalk.bold(`\nEvents — ${opts.range}\n`));
				printTable(
					["Time", "Type", "Name", "Path", "Visitor", "Country", "Revenue"],
					events
						.slice(0, limit)
						.map((e) => [
							e.timestamp.slice(0, 16).replace("T", " "),
							e.event_type,
							(e.name || "-").length > 20 ? `${(e.name || "-").slice(0, 18)}..` : e.name || "-",
							e.path.length > 30 ? `${e.path.slice(0, 28)}..` : e.path,
							e.visitor_id.slice(0, 8),
							e.country || "-",
							e.revenue ? formatCurrency(e.revenue) : "-",
						]),
				);

				// Show top custom event names
				const customNames = new Map<string, number>();
				for (const e of events) {
					if (e.event_type === "custom" && e.name) {
						customNames.set(e.name, (customNames.get(e.name) ?? 0) + 1);
					}
				}
				if (customNames.size > 0) {
					const sorted = [...customNames.entries()].sort((a, b) => b[1] - a[1]);
					console.log(chalk.bold("\nCustom Event Names:"));
					printTable(
						["Event Name", "Count", "%"],
						sorted.map(([name, count]) => [
							name,
							formatNumber(count),
							formatPercent(
								Math.round((count / events.filter((e) => e.event_type === "custom").length) * 100),
							),
						]),
					);
				}

				const pageviews = events.filter((e) => e.event_type === "pageview").length;
				const conversions = events.filter((e) => e.event_type === "conversion").length;
				const custom = events.filter((e) => e.event_type === "custom").length;
				const totalRev = events.reduce((s, e) => s + (e.revenue ?? 0), 0);
				console.log(
					chalk.gray(
						`\n  Total: ${events.length} events | Pageviews: ${pageviews} | Conversions: ${conversions} | Custom: ${custom} | Revenue: ${formatCurrency(totalRev)}`,
					),
				);
			} catch (err) {
				console.error(chalk.red(err instanceof Error ? err.message : String(err)));
				process.exit(1);
			}
		},
	);

// revklik analytics journeys
const journeysCmd = analyticsCommand.command("journeys").description("Customer journey summaries");
siteOption(journeysCmd);
rangeOption(journeysCmd);
journeysCmd
	.option("-l, --limit <n>", "Max journeys to show", "20")
	.option("--sort <field>", "Sort by: date, steps, revenue, source, device", "steps")
	.action(
		async (opts: { site: string; range: string; limit: string; sort: string; json?: boolean }) => {
			try {
				const siteId = await resolveSite(opts.site);
				const limit = Math.min(Number(opts.limit) || 20, 100);
				const journeys = await getAnalyticsJourneys(siteId, opts.range, limit);

				const rows = journeys.map((j) => ({
					visitor: j.visitor_name || j.visitor_id.slice(0, 12),
					steps: j.steps.length,
					source: j.utm_source || j.referrer || "direct",
					device: j.device_type || "-",
					revenue: j.total_revenue,
					date: j.started_at.slice(0, 16).replace("T", " "),
					country: j.country || "-",
					identified: j.is_identified,
				}));

				const sortField = opts.sort as string;
				rows.sort((a, b) => {
					const k = sortField as keyof typeof a;
					if (k === "steps" || k === "revenue") {
						return Number(b[k]) - Number(a[k]);
					}
					return String(b[k]).localeCompare(String(a[k]));
				});

				if (opts.json || process.argv.includes("--json")) {
					printJson(rows);
					return;
				}

				console.log(chalk.bold(`\nCustomer Journeys — ${opts.range}\n`));
				printTable(
					["Visitor", "Steps", "Source", "Device", "Revenue", "Date", "Country"],
					rows.map((r) => [
						(r.visitor.length > 16 ? `${r.visitor.slice(0, 16)}..` : r.visitor) +
							(r.identified ? " *" : ""),
						String(r.steps),
						r.source.length > 14 ? `${r.source.slice(0, 14)}..` : r.source,
						r.device,
						formatCurrency(r.revenue),
						r.date,
						r.country,
					]),
				);

				const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
				const avgSteps =
					rows.length > 0 ? (rows.reduce((s, r) => s + r.steps, 0) / rows.length).toFixed(1) : "0";
				const conversions = journeys.filter((j) => j.total_revenue > 0).length;
				console.log(
					chalk.gray(
						`\n  Total: ${rows.length} journeys | Avg steps: ${avgSteps} | Revenue: ${formatCurrency(totalRevenue)} | Converting: ${conversions}`,
					),
				);
			} catch (err) {
				console.error(chalk.red(err instanceof Error ? err.message : String(err)));
				process.exit(1);
			}
		},
	);

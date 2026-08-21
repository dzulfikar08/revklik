import chalk from "chalk";
import Table from "cli-table3";

export function formatNumber(n: number): string {
	return n.toLocaleString("en-US");
}

export function formatCurrency(n: number): string {
	return `$${n.toFixed(2)}`;
}

export function formatPercent(n: number): string {
	return `${Math.round(n)}%`;
}

export function printJson(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

export function printTable(headers: string[], rows: string[][]): void {
	const table = new Table({
		head: headers.map((h) => chalk.bold(h)),
		style: { head: [], border: ["gray"] },
	});
	table.push(...rows);
	console.log(table.toString());
}

export function printOverview(
	data: {
		pageviews: number;
		visitors: number;
		sessions: number;
		bounceRate: number;
		revenue: number;
		conversions: number;
	},
	siteName: string,
	range: string,
): void {
	console.log(
		chalk.bold(`\nRevKlik Analytics Overview — ${siteName} (Last ${range})\n`),
	);
	const table = new Table({
		head: [
			"Pageviews",
			"Visitors",
			"Sessions",
			"Bounce Rate",
			"Revenue",
			"Conversions",
		].map((h) => chalk.bold(h)),
		style: { head: [], border: ["gray"] },
	});
	table.push([
		formatNumber(data.pageviews),
		formatNumber(data.visitors),
		formatNumber(data.sessions),
		formatPercent(data.bounceRate),
		formatCurrency(data.revenue),
		formatNumber(data.conversions),
	]);
	console.log(table.toString());
}

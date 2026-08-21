import chalk from "chalk";
import { Command } from "commander";
import { listSites } from "../lib/api.js";
import { printTable } from "../lib/output.js";

export const sitesCommand = new Command("sites").description("Manage sites");

sitesCommand
	.command("list")
	.description("List all sites")
	.action(async () => {
		try {
			const sites = await listSites();
			if (sites.length === 0) {
				console.log(chalk.gray("No sites found."));
				return;
			}
			printTable(
				["ID", "Name", "Domain", "Created"],
				sites.map((s) => [s.id, s.name, s.domain, s.created_at.slice(0, 10)]),
			);
		} catch (err) {
			console.error(chalk.red(err instanceof Error ? err.message : String(err)));
			process.exit(1);
		}
	});

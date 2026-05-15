import { Command } from "commander";
import { listSites } from "../lib/api.js";
import { printJson, printTable, formatNumber } from "../lib/output.js";
import chalk from "chalk";

export const sitesCommand = new Command("sites")
  .description("Manage sites");

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
        sites.map((s) => [s.id, s.name, s.domain, s.created_at.slice(0, 10)])
      );
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

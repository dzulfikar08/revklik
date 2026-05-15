import { Command } from "commander";
import { whoami } from "../lib/api.js";
import { printJson } from "../lib/output.js";
import chalk from "chalk";

export const whoamiCommand = new Command("whoami")
  .description("Show current authentication info")
  .action(async () => {
    try {
      const data = await whoami();
      console.log(chalk.bold(`\nUser: ${data.user.name} (${data.user.email})`));
      console.log(`Plan:  ${data.plan}`);
      console.log(`Token: ${data.token.type} (${data.token.name})`);
      console.log(`Scopes: ${data.token.scopes.join(", ")}`);
      if (data.token.site_id) console.log(`Site:  ${data.token.site_id}`);
      console.log(`Created: ${data.token.created_at}`);
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

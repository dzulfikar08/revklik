import chalk from "chalk";
import { Command } from "commander";
import { whoami } from "../lib/api.js";

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
		} catch (err) {
			console.error(chalk.red(err instanceof Error ? err.message : String(err)));
			process.exit(1);
		}
	});

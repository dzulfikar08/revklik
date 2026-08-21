import { Command } from "commander";
import { analyticsCommand } from "./commands/analytics.js";
import { gscCommand } from "./commands/gsc.js";
import { loginCommand } from "./commands/login.js";
import { sitesCommand } from "./commands/sites.js";
import { tokensCommand } from "./commands/tokens.js";
import { whoamiCommand } from "./commands/whoami.js";
import { getConfig } from "./lib/config.js";

const program = new Command();

program
	.name("revklik")
	.description("RevKlik analytics CLI — query your analytics from the terminal")
	.version("1.2.0")
	.option("--json", "Output raw JSON")
	.option("--verbose", "Show debug information")
	.hook("preAction", (thisCommand, _actionCommand) => {
		const opts = thisCommand.opts();
		if (opts.verbose) {
			const config = getConfig();
			console.error(`[debug] API base: ${config.apiBase || "https://revklik.com/api"}`);
			console.error(`[debug] Token: ${config.token ? `${config.token.slice(0, 7)}...` : "none"}`);
		}
	});

program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(sitesCommand);
program.addCommand(analyticsCommand);
program.addCommand(tokensCommand);
program.addCommand(gscCommand);

program.parse();

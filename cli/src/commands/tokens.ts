import { Command } from "commander";
import { listTokens, createToken, revokeToken } from "../lib/api.js";
import { printTable } from "../lib/output.js";
import chalk from "chalk";

export const tokensCommand = new Command("tokens")
  .description("Manage API tokens");

// revklik tokens list
tokensCommand
  .command("list")
  .description("List all API tokens")
  .action(async () => {
    try {
      const tokens = await listTokens();
      if (tokens.length === 0) {
        console.log(chalk.gray("No tokens found."));
        return;
      }
      printTable(
        ["ID", "Prefix", "Name", "Type", "Scopes", "Site", "Last Used", "Created"],
        tokens.map((t) => [
          t.id.slice(0, 8),
          t.prefix,
          t.name,
          t.type,
          t.scopes.join(", "),
          t.site_id ? t.site_id.slice(0, 8) : "-",
          t.last_used_at ? t.last_used_at.slice(0, 10) : "-",
          t.created_at.slice(0, 10),
        ])
      );
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

// revklik tokens create
tokensCommand
  .command("create")
  .description("Create a new API token")
  .requiredOption("-n, --name <name>", "Token name")
  .requiredOption("-t, --type <type>", "Token type (account or site)")
  .option("-s, --site <siteId>", "Site ID (required for site tokens)")
  .option("--scopes <scopes>", "Comma-separated scopes")
  .action(async (opts: { name: string; type: "account" | "site"; site?: string; scopes?: string }) => {
    try {
      if (opts.type !== "account" && opts.type !== "site") {
        console.error(chalk.red("Type must be 'account' or 'site'"));
        process.exit(1);
      }
      if (opts.type === "site" && !opts.site) {
        console.error(chalk.red("--site is required for site tokens"));
        process.exit(1);
      }

      const params: any = { name: opts.name, type: opts.type };
      if (opts.site) params.site_id = opts.site;
      if (opts.scopes) params.scopes = opts.scopes.split(",").map((s) => s.trim());

      const result = await createToken(params);

      console.log(chalk.green("\nToken created successfully!"));
      console.log(chalk.bold(`Token: ${result.token}`));
      console.log(chalk.yellow("\nSave this token now — it won't be shown again."));
      console.log(chalk.gray(`Type: ${result.type} | Prefix: ${result.prefix} | Scopes: ${result.scopes.join(", ")}`));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

// revklik tokens revoke
tokensCommand
  .command("revoke")
  .description("Revoke an API token")
  .argument("<id>", "Token ID")
  .action(async (id: string) => {
    try {
      await revokeToken(id);
      console.log(chalk.green(`Token ${id} revoked.`));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

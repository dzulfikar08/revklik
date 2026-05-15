import { Command } from "commander";
import { createInterface } from "node:readline";
import { saveConfig, getApiBase } from "../lib/config.js";
import chalk from "chalk";
import open from "open";

export const loginCommand = new Command("login")
  .description("Authenticate with RevKlik")
  .option("--token <token>", "Provide token directly (no browser)")
  .action(async (opts: { token?: string }) => {
    let token = opts.token;

    if (!token) {
      const baseUrl = getApiBase().replace("/api", "").replace("//api", "//app");
      const tokenUrl = `${baseUrl}/settings/api-tokens`;
      console.log(chalk.cyan(`Opening browser to create a token...`));
      console.log(chalk.gray(`If browser doesn't open, visit: ${tokenUrl}\n`));
      try { await open(tokenUrl); } catch { /* ignore */ }

      token = await promptInput("Paste your token: ");
    }

    if (!token) {
      console.error(chalk.red("No token provided."));
      process.exit(1);
    }

    if (!token.startsWith("rvt_") && !token.startsWith("rv_")) {
      console.error(chalk.red("Invalid token. Token must start with rvt_ (account) or rv_ (site)."));
      process.exit(1);
    }

    // Validate token by calling whoami
    const base = getApiBase();
    try {
      const res = await fetch(`${base}/v1/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as any;
      const user = data.data?.user;

      saveConfig({ token });

      console.log(chalk.green(`\nAuthenticated as ${user?.name || user?.email || "unknown"} (${data.data?.token?.type || "unknown"} token)`));
      if (data.data?.plan) console.log(chalk.gray(`Plan: ${data.data.plan}`));
    } catch (err: any) {
      console.error(chalk.red(`Authentication failed: ${err.message}`));
      process.exit(1);
    }
  });

function promptInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

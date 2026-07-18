import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "revklik");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface RevklikConfig {
	token?: string;
	apiBase?: string;
	defaultSiteId?: string;
}

export function getConfig(): RevklikConfig {
	// Env vars override file config
	const envToken = process.env.REVKLIK_TOKEN;
	const envBase = process.env.REVKLIK_API_BASE;

	let fileConfig: RevklikConfig = {};
	if (existsSync(CONFIG_PATH)) {
		try {
			fileConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		} catch {
			/* ignore */
		}
	}

	return {
		...fileConfig,
		...(envToken && { token: envToken }),
		...(envBase && { apiBase: envBase }),
	};
}

export function saveConfig(config: RevklikConfig): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
	const existing = getConfig();
	const merged = { ...existing, ...config };
	writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

export function getToken(): string {
	const config = getConfig();
	if (!config.token) {
		console.error("Not logged in. Run: revklik login");
		process.exit(1);
	}
	return config.token;
}

export function getApiBase(): string {
	return getConfig().apiBase || "https://app.revklik.com/api";
}

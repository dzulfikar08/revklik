/** Shared by the revenue scripts: `wrangler d1 execute klikapa-db` as a function. */
const DATABASE = "klikapa-db";

export type D1Target = "--remote" | "--local";

export function d1Execute(target: D1Target, ...extra: string[]): string {
	const proc = Bun.spawnSync(["npx", "wrangler", "d1", "execute", DATABASE, target, ...extra], {
		stdin: "inherit",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error(`wrangler failed: ${proc.stderr.toString() || proc.stdout.toString()}`);
	}
	return proc.stdout.toString();
}

/** Run a read-only statement and return its rows. */
export function d1Select<T>(target: D1Target, sql: string): T[] {
	const parsed = JSON.parse(d1Execute(target, "--json", "--command", sql)) as Array<{
		results: T[];
	}>;
	return parsed[0]?.results ?? [];
}

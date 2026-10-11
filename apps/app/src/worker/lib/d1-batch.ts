import type { Compilable } from "kysely";

/** Max statements per D1 batch call; larger lists are split into sequential batches. */
export const D1_BATCH_CHUNK = 100;

/**
 * Run Kysely queries through D1's batch API: one round trip and one implicit
 * transaction per chunk instead of one await per statement.
 */
export async function executeBatch(
	d1: D1Database,
	queries: Compilable[],
	chunk = D1_BATCH_CHUNK,
): Promise<void> {
	for (let i = 0; i < queries.length; i += chunk) {
		const stmts = queries.slice(i, i + chunk).map((q) => {
			const compiled = q.compile();
			return d1.prepare(compiled.sql).bind(...compiled.parameters);
		});
		await d1.batch(stmts);
	}
}

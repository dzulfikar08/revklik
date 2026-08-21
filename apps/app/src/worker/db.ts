import {
	type Dialect,
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	sql,
} from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";

export function createDb(d1: D1Database): Kysely<KlikapaDatabase> {
	return new Kysely<KlikapaDatabase>({
		dialect: {
			createDriver() {
				const connection = {
					async executeQuery<R>(compiledQuery: {
						sql: string;
						parameters: ReadonlyArray<unknown>;
					}) {
						const stmt = d1.prepare(compiledQuery.sql);
						const bound = stmt.bind(...compiledQuery.parameters);
						const result = await bound.all();
						return { rows: (result.results as R[]) ?? [] };
					},
					async *streamQuery<R>(): AsyncGenerator<{ rows: R[] }> {
						yield { rows: [] };
					},
				};
				return {
					async init() {},
					async acquireConnection() {
						return connection;
					},
					async beginTransaction() {},
					async commitTransaction() {},
					async rollbackTransaction() {},
					async releaseConnection() {},
					async destroy() {},
				};
			},
			createQueryCompiler() {
				return new SqliteQueryCompiler();
			},
			createAdapter() {
				return new SqliteAdapter();
			},
			createIntrospector(db: Kysely<KlikapaDatabase>) {
				return new SqliteIntrospector(db);
			},
		} as unknown as Dialect,
	});
}

export { sql };

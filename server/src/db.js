import {
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	sql,
} from "kysely";
export function createDb(d1) {
	return new Kysely({
		dialect: {
			createDriver() {
				const connection = {
					async executeQuery(compiledQuery) {
						const stmt = d1.prepare(compiledQuery.sql);
						const bound = stmt.bind(...compiledQuery.parameters);
						const result = await bound.all();
						return { rows: result.results ?? [] };
					},
					async *streamQuery() {
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
			createIntrospector(db) {
				return new SqliteIntrospector(db);
			},
		},
	});
}
export { sql };

import {
	ColumnNode,
	InsertQueryNode,
	type KyselyPlugin,
	type OperationNode,
	type PluginTransformQueryArgs,
	type PluginTransformResultArgs,
	PrimitiveValueListNode,
	type QueryResult,
	type RootOperationNode,
	type UnknownRow,
	ValueListNode,
	ValueNode,
	ValuesNode,
	type ValuesItemNode,
} from "kysely";
import { classifySource } from "./source-sql";

/** Tables whose rows carry a stamped `source`. */
const STAMPED_TABLES: Record<string, true> = { events: true, sessions: true };

/** A literal string-or-null cell (a DEFAULT cell counts as NULL), or `undefined` when it is an expression. */
function literalOf(cell: unknown): string | null | undefined {
	if (cell === null || typeof cell === "string") return cell;
	if (typeof cell !== "object") return undefined;
	const { kind } = cell as OperationNode;
	if (kind === "DefaultInsertValueNode") return null;
	if (kind !== "ValueNode") return undefined;
	const { value } = cell as ValueNode;
	return value === null || typeof value === "string" ? value : undefined;
}

/** One row with its `source` appended, or null when a classifier input is not a literal. */
function stampRow(
	row: ValuesItemNode,
	at: { referrer: number; utm: number; browser: number },
): ValuesItemNode | null {
	const cells: ReadonlyArray<unknown> = row.values;
	const cell = (i: number): string | null | undefined => (i < 0 ? null : literalOf(cells[i]));
	const referrer = cell(at.referrer);
	const utm_source = cell(at.utm);
	const browser = cell(at.browser);
	if (referrer === undefined || utm_source === undefined || browser === undefined) return null;
	const source = classifySource({ referrer, utm_source, browser });
	return PrimitiveValueListNode.is(row)
		? PrimitiveValueListNode.create([...row.values, source])
		: ValueListNode.create([
				...(row.values as ReadonlyArray<OperationNode>),
				ValueNode.create(source),
			]);
}

/**
 * Stamps `source` on every Kysely INSERT into events or sessions, computed from
 * the row's own referrer / utm_source / browser with the same rule the dashboard
 * SQL applies (`classifySource`). Every ingest path (tracker, server events,
 * payment webhooks, imports) therefore stays consistent without each repeating
 * the call. Inserts that already set `source`, insert from a SELECT, or bind an
 * expression for one of the inputs are left alone; reads fall back to computing
 * the source for such unstamped rows.
 */
export class SourceStampPlugin implements KyselyPlugin {
	transformQuery({ node }: PluginTransformQueryArgs): RootOperationNode {
		if (!InsertQueryNode.is(node)) return node;
		const table = node.into?.table.identifier.name;
		const columns = node.columns;
		if (!(table && STAMPED_TABLES[table] && columns && node.values)) return node;
		if (!ValuesNode.is(node.values)) return node;

		const names = columns.map((c) => c.column.name);
		if (names.includes("source")) return node;
		const at = {
			referrer: names.indexOf("referrer"),
			utm: names.indexOf("utm_source"),
			browser: names.indexOf("browser"),
		};

		const rows: ValuesItemNode[] = [];
		for (const row of node.values.values) {
			const stamped = stampRow(row, at);
			if (!stamped) return node;
			rows.push(stamped);
		}
		return InsertQueryNode.cloneWith(node, {
			columns: [...columns, ColumnNode.create("source")],
			values: ValuesNode.create(rows),
		});
	}

	async transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
		return result;
	}
}

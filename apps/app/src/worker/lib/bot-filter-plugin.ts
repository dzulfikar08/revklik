import {
	AliasNode,
	BinaryOperationNode,
	ColumnNode,
	IdentifierNode,
	type KyselyPlugin,
	OperationNodeTransformer,
	OperatorNode,
	type OperationNode,
	type PluginTransformQueryArgs,
	type PluginTransformResultArgs,
	type QueryId,
	type QueryResult,
	ReferenceNode,
	type RootOperationNode,
	type SelectQueryNode,
	TableNode,
	type UnknownRow,
	ValueNode,
	WhereNode,
} from "kysely";

/** Tables whose rows carry `is_bot`; every read of them is human-only by default. */
const BOT_FLAGGED_TABLES: Record<string, true> = {
	events: true,
	sessions: true,
	visitor_profiles: true,
};

/** True when the operation tree filters on an `is_bot` column (nested selects excluded). */
function filtersOnIsBot(node: unknown): boolean {
	if (!node || typeof node !== "object") return false;
	const n = node as { kind?: string; column?: { name?: string } };
	if (n.kind === "SelectQueryNode") return false;
	if (n.kind === "ColumnNode" && n.column?.name === "is_bot") return true;
	for (const value of Object.values(node)) {
		if (Array.isArray(value) ? value.some(filtersOnIsBot) : filtersOnIsBot(value)) return true;
	}
	return false;
}

/** The table a FROM/JOIN item reads and the name it is referenced by, if it is a bare table. */
function tableOf(item: OperationNode): { table: string; ref: string } | null {
	if (AliasNode.is(item) && TableNode.is(item.node) && IdentifierNode.is(item.alias)) {
		return { table: item.node.table.identifier.name, ref: item.alias.name };
	}
	if (TableNode.is(item)) {
		const name = item.table.identifier.name;
		return { table: name, ref: name };
	}
	return null;
}

class BotFilterTransformer extends OperationNodeTransformer {
	protected override transformSelectQuery(
		node: SelectQueryNode,
		queryId?: QueryId,
	): SelectQueryNode {
		const out = super.transformSelectQuery(node, queryId);
		// A query that names is_bot itself decides what to include (usage metering,
		// admin totals and the backfill count every stored row).
		if (filtersOnIsBot(out.where)) return out;

		const sources = [
			...(out.from?.froms ?? []),
			// LEFT/RIGHT joins keep unmatched rows; a WHERE on them would drop those.
			...(out.joins ?? []).filter((j) => j.joinType === "InnerJoin").map((j) => j.table),
		];
		let where = out.where;
		for (const source of sources) {
			const t = tableOf(source);
			if (!t || !BOT_FLAGGED_TABLES[t.table]) continue;
			const humansOnly = BinaryOperationNode.create(
				ReferenceNode.create(ColumnNode.create("is_bot"), TableNode.create(t.ref)),
				OperatorNode.create("="),
				ValueNode.createImmediate(0),
			);
			where = where
				? WhereNode.cloneWithOperation(where, "And", humansOnly)
				: WhereNode.create(humansOnly);
		}
		return where === out.where ? out : { ...out, where };
	}
}

/**
 * Makes every Kysely SELECT over events, sessions or visitor_profiles read
 * humans only. New analytics queries get the filter for free, and a query that
 * filters on `is_bot` itself (for example `.where("is_bot", "in", [0, 1])`) opts
 * out. Writes and raw `sql` fragments are untouched.
 */
export class BotFilterPlugin implements KyselyPlugin {
	readonly #transformer = new BotFilterTransformer();

	transformQuery({ node, queryId }: PluginTransformQueryArgs): RootOperationNode {
		return this.#transformer.transformNode(node, queryId);
	}

	async transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
		return result;
	}
}

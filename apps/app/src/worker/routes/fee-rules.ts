import { Hono } from "hono";
import type { Env } from "../types";
import { loadEffectiveFeeRules, normalizeRail } from "../lib/fees";
import { normalizeCurrency } from "../lib/fx";

export const feeRuleRoutes = new Hono<Env>();

const MAX_RULES_PER_REQUEST = 50;
const MAX_PERCENT_BPS = 10_000;

interface RuleInput {
	rail: string;
	reset: boolean;
	percent_bps: number;
	fixed_amount: number;
	fixed_currency: string | null;
}

/** One body entry, or an error message. */
function parseRule(raw: unknown): RuleInput | string {
	if (!raw || typeof raw !== "object") return "each rule must be an object";
	const r = raw as Record<string, unknown>;
	const rail = normalizeRail(r.rail);
	if (!rail) return "rail must be lowercase letters, digits, _ . or -";
	if (r.reset === true) {
		return { rail, reset: true, percent_bps: 0, fixed_amount: 0, fixed_currency: null };
	}
	const bps = r.percent_bps;
	if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > MAX_PERCENT_BPS) {
		return `${rail}: percent_bps must be an integer from 0 to ${MAX_PERCENT_BPS}`;
	}
	const fixed = r.fixed_amount ?? 0;
	if (typeof fixed !== "number" || !Number.isFinite(fixed) || fixed < 0) {
		return `${rail}: fixed_amount must be a number >= 0`;
	}
	let fixedCurrency: string | null = null;
	if (fixed > 0) {
		fixedCurrency = r.fixed_currency == null ? "USD" : normalizeCurrency(r.fixed_currency);
		if (!fixedCurrency) return `${rail}: fixed_currency must be a 3-letter code`;
	}
	return {
		rail,
		reset: false,
		percent_bps: bps,
		fixed_amount: fixed,
		fixed_currency: fixedCurrency,
	};
}

// GET / — effective rules: built-in defaults overlaid with the caller's own
feeRuleRoutes.get("/", async (c) => {
	const { rules, custom } = await loadEffectiveFeeRules(c.get("db"), c.get("userId"));
	return c.json({
		data: rules.map((r) => ({ ...r, is_default: !custom.includes(r.rail) })),
		success: true,
	});
});

// PUT / — body { rules: [{ rail, percent_bps, fixed_amount?, fixed_currency? } | { rail, reset: true }] }
// Rules apply to events ingested afterwards; stored nets are never recomputed.
feeRuleRoutes.put("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const body = (await c.req.json().catch(() => null)) as { rules?: unknown } | null;
	if (!body || !Array.isArray(body.rules) || body.rules.length > MAX_RULES_PER_REQUEST) {
		return c.json(
			{ error: `rules must be an array of up to ${MAX_RULES_PER_REQUEST}`, success: false },
			400,
		);
	}
	const parsed: RuleInput[] = [];
	for (const raw of body.rules) {
		const rule = parseRule(raw);
		if (typeof rule === "string") return c.json({ error: rule, success: false }, 400);
		parsed.push(rule);
	}

	const now = Date.now();
	for (const rule of parsed) {
		if (rule.reset) {
			await db
				.deleteFrom("fee_rules")
				.where("user_id", "=", userId)
				.where("rail", "=", rule.rail)
				.execute();
			continue;
		}
		await db
			.insertInto("fee_rules")
			.values({
				user_id: userId,
				rail: rule.rail,
				percent_bps: rule.percent_bps,
				fixed_amount: rule.fixed_amount,
				fixed_currency: rule.fixed_currency,
				updated_at: now,
			})
			.onConflict((oc) =>
				oc.columns(["user_id", "rail"]).doUpdateSet({
					percent_bps: rule.percent_bps,
					fixed_amount: rule.fixed_amount,
					fixed_currency: rule.fixed_currency,
					updated_at: now,
				}),
			)
			.execute();
	}

	const { rules, custom } = await loadEffectiveFeeRules(db, userId);
	return c.json({
		data: rules.map((r) => ({ ...r, is_default: !custom.includes(r.rail) })),
		success: true,
	});
});

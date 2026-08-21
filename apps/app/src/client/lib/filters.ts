import type { Filter } from "@revklik/shared";
import { FILTER_DIMENSIONS, FILTER_OPERATORS } from "@revklik/shared";

export { FILTER_DIMENSIONS, FILTER_OPERATORS };

export function parseFilterString(s: string): Filter[] {
	if (!s) return [];
	return s
		.split(",")
		.map((f) => {
			const [dimension, operator, ...rest] = f.split(":");
			return {
				dimension: dimension ?? "",
				operator: (operator ?? "is") as Filter["operator"],
				value: rest.join(":"),
			};
		})
		.filter(
			(f) =>
				f.dimension &&
				(f.value || f.operator === "exists" || f.operator === "not_exists"),
		);
}

export function encodeFilterString(rules: Filter[]): string {
	return rules.map((r) => `${r.dimension}:${r.operator}:${r.value}`).join(",");
}

export function toggleFilter(rules: Filter[], rule: Filter): Filter[] {
	const idx = rules.findIndex(
		(r) =>
			r.dimension === rule.dimension &&
			r.operator === rule.operator &&
			r.value === rule.value,
	);
	if (idx >= 0) return rules.filter((_, i) => i !== idx);
	return [...rules, rule];
}

export function dimensionLabel(dim: string): string {
	return FILTER_DIMENSIONS.find((d) => d.value === dim)?.label ?? dim;
}

export function operatorLabel(op: string): string {
	return FILTER_OPERATORS.find((o) => o.value === op)?.label ?? op;
}

export function formatFilterLabel(rule: Filter): string {
	if (rule.operator === "exists")
		return `${dimensionLabel(rule.dimension)} exists`;
	if (rule.operator === "not_exists")
		return `${dimensionLabel(rule.dimension)} doesn't exist`;
	return `${dimensionLabel(rule.dimension)} ${operatorLabel(rule.operator)} ${rule.value}`;
}

export function matchesRule(rule: Filter, obj: Record<string, unknown>): boolean {
	const val = obj[rule.dimension];
	if (rule.operator === "exists") return val != null && val !== "";
	if (rule.operator === "not_exists") return val == null || val === "";
	if (val == null) return false;
	const s = String(val);
	if (rule.operator === "is") return s === rule.value;
	if (rule.operator === "is_not") return s !== rule.value;
	if (rule.operator === "contains")
		return s.toLowerCase().includes(rule.value.toLowerCase());
	if (rule.operator === "not_contains")
		return !s.toLowerCase().includes(rule.value.toLowerCase());
	if (rule.operator === "starts_with")
		return s.toLowerCase().startsWith(rule.value.toLowerCase());
	return true;
}

export function matchesAllFilters(
	obj: Record<string, unknown>,
	filters: Filter[],
): boolean {
	return filters.every((f) => matchesRule(f, obj));
}

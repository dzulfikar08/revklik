/**
 * Click-to-filter model: every breakdown row toggles an `is` filter on its
 * dimension, and the same filter list drives every panel on the page.
 */
import type { LegacyFilter } from "@/lib/legacy/api";

const matches = (f: LegacyFilter, dimension: string, value: string): boolean =>
	f.dimension === dimension && f.operator === "is" && f.value === value;

export const isFilterOn = (
	filters: readonly LegacyFilter[],
	dimension: string,
	value: string,
): boolean => filters.some((f) => matches(f, dimension, value));

/** Adds `dimension is value`, or removes it when that exact filter is already on. */
export const toggleFilter = (
	filters: readonly LegacyFilter[],
	dimension: string,
	value: string,
): LegacyFilter[] =>
	isFilterOn(filters, dimension, value)
		? filters.filter((f) => !matches(f, dimension, value))
		: [...filters, { dimension, operator: "is", value }];

/** Same filter twice is a no-op, so the manual builder cannot stack duplicates. */
export const addFilter = (filters: readonly LegacyFilter[], next: LegacyFilter): LegacyFilter[] =>
	filters.some(
		(f) => f.dimension === next.dimension && f.operator === next.operator && f.value === next.value,
	)
		? [...filters]
		: [...filters, next];

export const removeFilter = (
	filters: readonly LegacyFilter[],
	target: LegacyFilter,
): LegacyFilter[] =>
	filters.filter(
		(f) =>
			!(
				f.dimension === target.dimension &&
				f.operator === target.operator &&
				f.value === target.value
			),
	);

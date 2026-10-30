const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/;

/** Hours the synthetic pageviews of one imported day are spread over (12:00..19:00 UTC). */
const IMPORT_FIRST_HOUR = 12;
const IMPORT_HOUR_SPAN = 8;

/**
 * Calendar day (`YYYY-MM-DD`) of a OneDollarStats `time:day` value, which
 * arrives as `2026-04-30 00:00:00` as often as `2026-04-30`. Null when it is
 * not a real date.
 */
export function odsDay(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const match = DAY_RE.exec(raw.trim());
	if (!match) return null;
	const day = `${match[1]}-${match[2]}-${match[3]}`;
	const ms = Date.parse(`${day}T00:00:00Z`);
	return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(day) ? day : null;
}

/** ISO timestamp of the `index`-th synthetic pageview of an imported day. */
export function odsEventTimestamp(day: string, index: number): string {
	const hour = String(IMPORT_FIRST_HOUR + (index % IMPORT_HOUR_SPAN)).padStart(2, "0");
	return `${day}T${hour}:00:00.000Z`;
}

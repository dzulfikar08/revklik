/**
 * Day arithmetic for the Earnings screen, kept free of app imports so it can be
 * unit-tested. Days are the device's local days: the server cuts its day buckets
 * at `tz` (east-positive minutes), so shifting "now" by the offset makes the UTC
 * calendar read as the local one.
 */
export interface EarningsDaily {
	date: string;
	gross: number;
	net: number;
	sales: number;
}

export type EarningsPreset = "today" | "7d" | "month" | "30d" | "custom";

/** An inclusive YYYY-MM-DD range in local days. */
export interface DayRange {
	from: string;
	to: string;
}

const MS_PER_DAY = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** East-positive UTC offset in minutes of the device (WIB = 420), sent as `tz`. */
export const deviceTzOffset = (): number => -new Date().getTimezoneOffset();

/** Inclusive local-day range for a preset. */
export const presetRange = (
	preset: EarningsPreset,
	nowMs = Date.now(),
	tzOffset = deviceTzOffset(),
): DayRange => {
	const local = nowMs + tzOffset * 60_000;
	const to = isoDay(local);
	switch (preset) {
		case "7d": {
			return { from: isoDay(local - 6 * MS_PER_DAY), to };
		}
		case "month": {
			return { from: `${to.slice(0, 7)}-01`, to };
		}
		case "30d": {
			return { from: isoDay(local - 29 * MS_PER_DAY), to };
		}
		default: {
			return { from: to, to };
		}
	}
};

/** Every day in [from, to], zero-filled where the server returned no row. */
export const fillDaily = (daily: EarningsDaily[], from: string, to: string): EarningsDaily[] => {
	const byDate = new Map(daily.map((d) => [d.date, d]));
	const out: EarningsDaily[] = [];
	const end = Date.parse(`${to}T00:00:00Z`);
	for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= end; ms += MS_PER_DAY) {
		const date = isoDay(ms);
		out.push(byDate.get(date) ?? { date, gross: 0, net: 0, sales: 0 });
	}
	return out;
};

/**
 * The month grid of a calendar: weeks starting Monday, `null` for the blank cells
 * before the 1st and after the last day. `month` is 1-12.
 */
export const monthGrid = (year: number, month: number): (string | null)[][] => {
	const first = Date.UTC(year, month - 1, 1);
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const lead = (new Date(first).getUTCDay() + 6) % 7;
	const cells: (string | null)[] = Array.from({ length: lead }, () => null);
	for (let d = 0; d < daysInMonth; d++) cells.push(isoDay(first + d * MS_PER_DAY));
	while (cells.length % 7 !== 0) cells.push(null);
	const weeks: (string | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
};

/** Year and month (1-12) `delta` months away from the given one. */
export const shiftMonth = (year: number, month: number, delta: number): [number, number] => {
	const index = year * 12 + (month - 1) + delta;
	return [Math.floor(index / 12), (index % 12) + 1];
};

/**
 * Two-tap range picking: the first tap starts a new range on that day, the second
 * closes it (in either direction). `pending` is true while only the start is set.
 */
export const pickDay = (
	current: DayRange,
	pending: boolean,
	day: string,
): { range: DayRange; pending: boolean } => {
	if (!pending) return { pending: true, range: { from: day, to: day } };
	return {
		pending: false,
		range: day < current.from ? { from: day, to: current.from } : { from: current.from, to: day },
	};
};

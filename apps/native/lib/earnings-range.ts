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

export type EarningsPreset = "today" | "7d" | "month" | "30d";

const MS_PER_DAY = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** East-positive UTC offset in minutes of the device (WIB = 420), sent as `tz`. */
export const deviceTzOffset = (): number => -new Date().getTimezoneOffset();

/** Inclusive local-day range for a preset. */
export const presetRange = (
	preset: EarningsPreset,
	nowMs = Date.now(),
	tzOffset = deviceTzOffset(),
): { from: string; to: string } => {
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

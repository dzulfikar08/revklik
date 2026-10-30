/**
 * Run-rate forecast: today's pace extended in a straight line. It is
 * arithmetic on real daily revenue, not a model, so it needs enough history to
 * mean something and says so when it does not.
 */

export interface DailyRevenue {
	date: string;
	revenue: number;
	conversions: number;
}

export interface DailyVisitors {
	date: string;
	visitors: number;
}

export const MIN_WINDOW_DAYS = 7;
export const MIN_WINDOW_SALES = 3;
export const FORECAST_DAYS = 30;

export type RunRate =
	| {
			status: "ready";
			/** Completed days the average is taken over. */
			windowDays: number;
			windowRevenue: number;
			sales: number;
			dailyAverage: number;
			projected: number;
	  }
	| {
			status: "not-enough";
			reason: "no-sales" | "too-few-days" | "too-few-sales";
			windowDays: number;
			sales: number;
	  };

/**
 * `revenue` and `visitors` are the dashboard's daily buckets, oldest first,
 * the last one being today (still filling, so it is left out). The window
 * starts on the first day the site recorded anything, so a site that is only
 * a week old is not averaged against a month of days before it existed.
 */
export const computeRunRate = (revenue: readonly DailyRevenue[], visitors: readonly DailyVisitors[]): RunRate => {
	const completed = revenue.slice(0, -1);
	const trafficDates = new Set(visitors.filter((v) => v.visitors > 0).map((v) => v.date.slice(0, 10)));
	const firstActive = completed.findIndex((d) => d.revenue !== 0 || trafficDates.has(d.date.slice(0, 10)));
	const window = firstActive === -1 ? [] : completed.slice(firstActive);

	const sales = window.reduce((sum, d) => sum + d.conversions, 0);
	const windowRevenue = window.reduce((sum, d) => sum + d.revenue, 0);

	if (sales === 0 || windowRevenue <= 0) {
		return { reason: "no-sales", sales, status: "not-enough", windowDays: window.length };
	}
	if (window.length < MIN_WINDOW_DAYS) {
		return { reason: "too-few-days", sales, status: "not-enough", windowDays: window.length };
	}
	if (sales < MIN_WINDOW_SALES) {
		return { reason: "too-few-sales", sales, status: "not-enough", windowDays: window.length };
	}

	const dailyAverage = windowRevenue / window.length;
	return {
		dailyAverage,
		projected: dailyAverage * FORECAST_DAYS,
		sales,
		status: "ready",
		windowDays: window.length,
		windowRevenue,
	};
};

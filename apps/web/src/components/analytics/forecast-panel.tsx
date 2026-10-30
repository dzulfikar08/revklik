import { useQuery } from "@tanstack/react-query";

import { useT } from "@/lib/i18n";
import { fetchDashboard } from "@/lib/legacy/api";
import { computeRunRate, FORECAST_DAYS, MIN_WINDOW_DAYS, MIN_WINDOW_SALES } from "@/lib/run-rate";
import type { RunRate } from "@/lib/run-rate";

import { money } from "./data";
import { Panel } from "./ui";

/** Same box in every state, so the grid never jumps when the number arrives. */
const BODY = "flex min-h-24 flex-col justify-center gap-1";

const emptyKey = (reason: Extract<RunRate, { status: "not-enough" }>["reason"]) => {
	if (reason === "too-few-days") {
		return "forecast.tooFewDays";
	}
	if (reason === "too-few-sales") {
		return "forecast.tooFewSales";
	}
	return "forecast.noSales";
};

/**
 * Straight-line revenue run-rate from the last 30 days of real sales, in the
 * site's own currency. It is arithmetic, not a prediction, and says so.
 */
export const RunRateForecastPanel = ({
	currency,
	siteId,
}: {
	currency?: string;
	siteId: string;
}) => {
	const t = useT();
	const q = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchDashboard(siteId, "30d", ""),
		queryKey: ["legacy", "dash", siteId, "30d", ""],
		retry: false,
		staleTime: 60_000,
	});

	const code = q.data?.currency ?? currency;
	const rate = q.data
		? computeRunRate(
				q.data.revenueTimeseries ?? [],
				(q.data.timeseries ?? []).map((p) => ({ date: p.date, visitors: p.visitors })),
			)
		: null;

	return (
		<Panel title={t("forecast.title")} hint={t("forecast.hint", { days: FORECAST_DAYS })}>
			{q.isLoading ? (
				<div className={BODY} role="status">
					<span className="sr-only">{t("forecast.loading")}</span>
					<div className="bg-muted/40 h-8 w-40 animate-pulse rounded-lg" aria-hidden />
					<div className="bg-muted/40 h-3 w-56 animate-pulse rounded" aria-hidden />
				</div>
			) : q.error || !rate ? (
				<div className={BODY}>
					<p className="text-muted-foreground text-xs">{t("forecast.error")}</p>
					<button
						className="text-primary focus-visible:outline-ring w-fit text-xs font-medium underline-offset-2 outline-offset-2 hover:underline focus-visible:outline-2"
						onClick={() => void q.refetch()}
						type="button"
					>
						{t("forecast.retry")}
					</button>
				</div>
			) : rate.status === "ready" ? (
				<div className={BODY}>
					<p className="text-2xl font-semibold tracking-tight tabular-nums">
						{money(rate.projected, code)}
					</p>
					<p className="text-foreground/80 text-xs text-pretty">
						{t("forecast.basis", {
							avg: money(rate.dailyAverage, code),
							days: rate.windowDays,
							n: rate.sales,
						})}
					</p>
					<p className="text-muted-foreground text-xs text-pretty">{t("forecast.caveat")}</p>
				</div>
			) : (
				<div className={BODY}>
					<p className="text-muted-foreground text-xs text-pretty">
						{t(emptyKey(rate.reason), {
							have: rate.windowDays,
							minDays: MIN_WINDOW_DAYS,
							minSales: MIN_WINDOW_SALES,
							n: rate.sales,
						})}
					</p>
				</div>
			)}
		</Panel>
	);
};

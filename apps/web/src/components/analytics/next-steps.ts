/**
 * "What next": at most three actions, each backed by a number on this page.
 * Pure so the rules are testable; the home view turns each id into copy.
 */
import type { SiteDashboard } from "@/lib/legacy/api";

export type NextStep =
	| { id: "install" }
	| { id: "connect" }
	| { id: "bestSource"; source: string; share: number; sales: number }
	| { id: "bestPage"; path: string; sales: number }
	| { id: "revenueDown"; pct: number }
	| { id: "feesEstimated" };

const MAX_STEPS = 3;
/** A drop at least this large (percent) is worth a line of its own. */
const DOWN_ALERT_PCT = 20;
const PERCENT = 100;

export const deriveNextSteps = (
	dash: SiteDashboard | undefined,
	installed: boolean,
): NextStep[] => {
	if (!installed) {
		return [{ id: "install" }];
	}
	if (!dash) {
		return [];
	}
	const steps: NextStep[] = [];
	const { stats } = dash;
	const previousRevenue = dash.compare?.revenue?.previous ?? 0;

	if (stats.revenue === 0 && previousRevenue === 0 && stats.visitors > 0) {
		steps.push({ id: "connect" });
	}

	const totalRevenue = dash.revenueBySource.reduce((sum, r) => sum + Math.max(r.revenue, 0), 0);
	const topSource = dash.revenueBySource
		.filter((r) => r.revenue > 0)
		.toSorted((a, b) => b.revenue - a.revenue)[0];
	if (topSource && totalRevenue > 0) {
		steps.push({
			id: "bestSource",
			sales: topSource.conversions,
			share: Math.round((topSource.revenue / totalRevenue) * PERCENT),
			source: topSource.source,
		});
	}

	const topPage = dash.entryPagesRevenue
		.filter((p) => p.revenue > 0)
		.toSorted((a, b) => b.revenue - a.revenue)[0];
	if (topPage) {
		steps.push({ id: "bestPage", path: topPage.path, sales: topPage.conversions });
	}

	const change = dash.compare?.revenue;
	if (
		change &&
		change.previous > 0 &&
		change.changePct !== null &&
		change.changePct <= -DOWN_ALERT_PCT
	) {
		steps.push({ id: "revenueDown", pct: Math.abs(Math.round(change.changePct)) });
	}

	if (stats.netEstimated) {
		steps.push({ id: "feesEstimated" });
	}
	return steps.slice(0, MAX_STEPS);
};

import { createFileRoute } from "@tanstack/react-router";

import AnalyticsPage from "@/components/analytics/analytics-page";
import { parseView } from "@/components/analytics/views";
import type { ViewKey } from "@/components/analytics/views";
import { isSelfHosted } from "@/lib/instance-config";
import { parsePlan } from "@/lib/legacy/billing";
import type { PlanTier } from "@/lib/legacy/billing";

interface DashboardSearch {
	/** Active section; omitted for home so plain dashboard URLs stay clean. */
	view?: Exclude<ViewKey, "home">;
	/** Tier to highlight when the billing view opens from an upgrade prompt. */
	plan?: PlanTier;
}

export const Route = createFileRoute("/analytics/$siteId")({
	validateSearch: (search: Record<string, unknown>): DashboardSearch => {
		const out: DashboardSearch = {};
		const parsed = parseView(search.view);
		// No billing section on self-hosted instances.
		const view = parsed === "billing" && isSelfHosted() ? "home" : parsed;
		if (view !== "home") out.view = view;
		const plan = parsePlan(search.plan);
		if (plan && view === "billing") out.plan = plan;
		return out;
	},
	component: RouteComponent,
	head: () => ({ meta: [{ title: "Analytics · RevKlik" }] }),
});

function RouteComponent() {
	const { siteId } = Route.useParams();
	const { view = "home", plan } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<AnalyticsPage
			siteId={siteId}
			view={view}
			highlightPlan={plan}
			onView={(next) =>
				void navigate({
					search: (prev) => ({
						...prev,
						plan: undefined,
						view: next === "home" ? undefined : next,
					}),
				})
			}
		/>
	);
}

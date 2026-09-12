import { createFileRoute } from "@tanstack/react-router";

import AnalyticsPage from "@/components/analytics/analytics-page";

export const Route = createFileRoute("/analytics/$siteId")({
	component: RouteComponent,
	head: () => ({ meta: [{ title: "Analytics · revklik" }] }),
});

function RouteComponent() {
	const { siteId } = Route.useParams();
	return <AnalyticsPage siteId={siteId} />;
}

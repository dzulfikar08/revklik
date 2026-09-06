import { createFileRoute } from "@tanstack/react-router";

import SitesOverviewPage from "@/components/analytics/sites-overview";

export const Route = createFileRoute("/analytics/")({
  component: SitesOverviewPage,
  head: () => ({ meta: [{ title: "Sites · revklik" }] }),
});

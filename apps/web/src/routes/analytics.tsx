import { createFileRoute, redirect } from "@tanstack/react-router";

import AnalyticsPage from "@/components/analytics/analytics-page";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/analytics")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }
  },
  component: AnalyticsPage,
  head: () => ({ meta: [{ title: "Analytics · revklik" }] }),
});

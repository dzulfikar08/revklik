import { createFileRoute, redirect } from "@tanstack/react-router";

import AnalyticsPage from "@/components/analytics/analytics-page";

export const Route = createFileRoute("/analytics")({
  beforeLoad: async () => {
    // Dynamic import keeps better-auth (and the whole auth client) out of the
    // entry chunk; it is only needed when this route's guard actually runs.
    const { authClient } = await import("@/lib/auth-client");
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }
  },
  component: AnalyticsPage,
  head: () => ({ meta: [{ title: "Analytics · revklik" }] }),
});

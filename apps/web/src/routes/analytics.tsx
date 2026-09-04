import { createFileRoute, redirect } from "@tanstack/react-router";

import AnalyticsPage from "@/components/analytics/analytics-page";
import { getToken, LEGACY_API_BASE, legacyLogout } from "@/lib/legacy/api";

export const Route = createFileRoute("/analytics")({
  beforeLoad: async () => {
    // Validate the klikapa session on entry; a dead token lands on /login.
    const token = await getToken();
    if (!token) {
      throw redirect({ to: "/login" });
    }
    const res = await fetch(`${LEGACY_API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      legacyLogout();
      throw redirect({ to: "/login" });
    }
  },
  component: AnalyticsPage,
  head: () => ({ meta: [{ title: "Analytics · revklik" }] }),
});

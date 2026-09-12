import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

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
	// Layout route: /analytics renders the sites overview, /analytics/$siteId
	// the per-site dashboard. Both pass through this session guard.
	component: () => <Outlet />,
	head: () => ({ meta: [{ title: "Analytics · revklik" }] }),
});

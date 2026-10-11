import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { parseNext } from "@/lib/auth-search";
import { getToken, LEGACY_API_BASE, legacyLogout } from "@/lib/legacy/api";

export const Route = createFileRoute("/analytics")({
	beforeLoad: async ({ location }) => {
		// Validate the klikapa session on entry; a dead token lands on /login.
		// Deep links (e.g. billing after ?checkout=success) come back after sign-in.
		const next = parseNext(location.href);
		const toLogin = () =>
			redirect({ search: next && next !== "/analytics" ? { next } : {}, to: "/login" });
		const token = await getToken();
		if (!token) {
			throw toLogin();
		}
		const res = await fetch(`${LEGACY_API_BASE}/auth/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			legacyLogout();
			throw toLogin();
		}
	},
	// Layout route: /analytics renders the sites overview, /analytics/$siteId
	// the per-site dashboard. Both pass through this session guard.
	component: () => <Outlet />,
	head: () => ({ meta: [{ title: "Analytics · RevKlik" }] }),
});

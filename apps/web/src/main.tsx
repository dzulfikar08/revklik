import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { parseNext } from "./lib/auth-search";
import { registerBillingOpener } from "./lib/billing-nav";
import { initInstanceConfig } from "./lib/instance-config";
import { registerSessionExpiredHandler } from "./lib/session-nav";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./utils/query-client";

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
	defaultPendingComponent: () => <Loader />,
	context: { queryClient },
	Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	},
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

// Mid-session 401: sign in again, then come back to the same page.
registerSessionExpiredHandler(() => {
	const { href, pathname } = router.state.location;
	if (pathname === "/login") return;
	const next = parseNext(href);
	void router.navigate({ search: next ? { next } : {}, to: "/login" });
});

const SITE_DASHBOARD = /^\/analytics\/([^/]+)\/?$/u;

// On a site dashboard, billing opens as that dashboard's view (the site
// picker stays put); everywhere else it opens the standalone billing page.
registerBillingOpener((plan) => {
	const siteId = router.state.location.pathname.match(SITE_DASHBOARD)?.[1];
	if (siteId && siteId !== "billing") {
		void router.navigate({
			params: { siteId },
			search: (prev) => ({ ...prev, plan, view: "billing" as const }),
			to: "/analytics/$siteId",
		});
		return;
	}
	void router.navigate({ search: { plan }, to: "/analytics/billing" });
});

const rootElement = document.getElementById("app");

if (!rootElement) {
	throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	// Self-hosted instances hide pricing and upgrade UI: know which kind this is first.
	void initInstanceConfig().then(() => root.render(<RouterProvider router={router} />));
}

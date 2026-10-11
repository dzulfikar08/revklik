import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy checkout return URL: hand off to billing, which confirms and refetches. */
export const Route = createFileRoute("/success")({
	beforeLoad: () => {
		throw redirect({ search: { checkout: "success" }, to: "/analytics/billing" });
	},
});

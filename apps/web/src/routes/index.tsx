import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseCheckoutResult } from "@/lib/legacy/billing";

/**
 * Old bookmarks hit the domain root: send them straight to the app.
 * Polar and Pakasir return here too (/?checkout=success,
 * /?checkout=pakasir_success); those go to billing for the confirmation.
 */
export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>) => {
		const checkout = parseCheckoutResult(search.checkout);
		return checkout ? { checkout } : {};
	},
	beforeLoad: ({ search }) => {
		if (search.checkout) {
			throw redirect({ search: { checkout: search.checkout }, to: "/analytics/billing" });
		}
		throw redirect({ to: "/analytics" });
	},
});

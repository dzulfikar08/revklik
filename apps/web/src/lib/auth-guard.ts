import { redirect } from "@tanstack/react-router";

import { afterAuthTarget } from "./auth-search";
import type { AuthSearch } from "./auth-search";
import { getToken } from "./legacy/api";

/**
 * /login and /register for someone who already has a session: send them on
 * to where signing in would have taken them. A dead token is caught by the
 * /analytics guard, which signs out and comes back here without one.
 */
export const redirectIfSignedIn = async (search: AuthSearch): Promise<void> => {
	if (!(await getToken())) {
		return;
	}
	const target = afterAuthTarget(search);
	if ("href" in target) {
		throw redirect({ href: target.href });
	}
	if (target.to === "/analytics/billing") {
		throw redirect({ search: target.search, to: target.to });
	}
	throw redirect({ to: "/analytics" });
};

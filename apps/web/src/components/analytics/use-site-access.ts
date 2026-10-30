import { useQuery } from "@tanstack/react-query";

import { FULL_ACCESS, fetchSiteAccess } from "@/lib/legacy/site-access";
import type { SiteAccess } from "@/lib/legacy/site-access";

/**
 * What the signed-in user may do on `siteId`. Loading and errors count as
 * full access so a slow or older API never locks the owner out of their own
 * controls; the server rejects anything the role does not allow.
 */
export const useSiteAccess = (siteId: string): SiteAccess => {
	const q = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchSiteAccess(siteId),
		queryKey: ["legacy", "site-access", siteId],
		retry: false,
		staleTime: 60_000,
	});
	return q.data ?? FULL_ACCESS;
};

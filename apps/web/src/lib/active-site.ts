/**
 * The site the owner looked at last. Pages outside a site (Portfolio) use it to
 * keep the per-site nav items reachable instead of dropping the owner out of
 * the site they were working in.
 */
const KEY = "kp_active_site";

export const rememberActiveSite = (siteId: string): void => {
	try {
		localStorage.setItem(KEY, siteId);
	} catch {
		// Storage blocked: the nav just offers fewer links.
	}
};

export const lastActiveSite = (): string | null => {
	try {
		return localStorage.getItem(KEY) || null;
	} catch {
		return null;
	}
};

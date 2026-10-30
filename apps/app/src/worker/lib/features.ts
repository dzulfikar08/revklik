/**
 * Shopee and Tokopedia order sync is unfinished: Shopee signs with a placeholder partner
 * key and both OAuth callbacks trust an unbound `state`. The routes answer 404 unless the
 * operator sets MARKETPLACES_ENABLED=1, which must not be done before those are fixed.
 */
export function marketplacesEnabled(env: { MARKETPLACES_ENABLED?: string } | undefined): boolean {
	const raw = env?.MARKETPLACES_ENABLED?.trim().toLowerCase();
	return raw === "1" || raw === "true";
}

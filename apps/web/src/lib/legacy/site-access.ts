/** The signed-in user's role on one site (owner, or a team role). */
import { legacyFetch } from "./api";

export type SiteRole = "owner" | "admin" | "editor" | "viewer";

export interface SiteAccess {
	role: SiteRole;
	can: { read: boolean; write: boolean; manage: boolean; owner: boolean };
}

/** Until the answer arrives the UI stays usable; the server enforces the real rule. */
export const FULL_ACCESS: SiteAccess = {
	can: { manage: true, owner: true, read: true, write: true },
	role: "owner",
};

export const fetchSiteAccess = (siteId: string): Promise<SiteAccess> =>
	legacyFetch(`/sites/${encodeURIComponent(siteId)}/access`);

export type SiteRole = "owner" | "admin" | "editor" | "viewer";

/**
 * What a caller is doing on a site.
 * - read: see the site's data.
 * - write: change analytics-side content and config (annotations, segments, reports,
 *   visitor notes, syncs, payment providers).
 * - manage: hand RevKlik credentials or bulk data (GSC service account, imports).
 * - owner: account-level decisions (delete the site, share it publicly, integrations, token scope).
 */
export type SiteAction = "read" | "write" | "manage" | "owner";

/** The single source of truth for who may do what on a site. Viewers are read-only. */
export const ROLE_TABLE: Record<SiteRole, Record<SiteAction, boolean>> = {
	owner: { read: true, write: true, manage: true, owner: true },
	admin: { read: true, write: true, manage: true, owner: false },
	editor: { read: true, write: true, manage: false, owner: false },
	viewer: { read: true, write: false, manage: false, owner: false },
};

const TEAM_ROLES: readonly string[] = ["admin", "editor", "viewer"];

/** A stored team role; anything unrecognised is treated as the least privileged. */
export function normalizeTeamRole(role: string | null | undefined): SiteRole {
	return TEAM_ROLES.includes(role ?? "") ? (role as SiteRole) : "viewer";
}

export function roleCan(role: SiteRole | null, action: SiteAction): boolean {
	return role !== null && ROLE_TABLE[role][action];
}

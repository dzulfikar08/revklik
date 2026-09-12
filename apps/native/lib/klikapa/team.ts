/**
 * Client for the production revklik (klikapa) Worker API — team management.
 * Port of apps/web/src/lib/legacy/team.ts. Mirrors the worker routes:
 * GET /team, POST /team/invite, PATCH /team/:memberId, DELETE /team/:memberId.
 */
import { legacyFetch } from "./api";

export type TeamRole = "admin" | "editor" | "viewer";

export interface LegacyTeamMember {
	id: string;
	site_id: string;
	user_id: string;
	role: TeamRole;
	invited_by: string;
	invited_at: string;
	accepted_at: string | null;
	name: string | null;
	email: string | null;
}

export interface LegacyTeamOwner {
	id: string;
	name: string;
	email: string;
	role: "owner";
}

export interface LegacyTeam {
	owner: LegacyTeamOwner | null;
	members: LegacyTeamMember[];
}

export const fetchTeam = (siteId: string): Promise<LegacyTeam> =>
	legacyFetch(`/team?site_id=${siteId}`);

export const inviteTeamMember = (
	siteId: string,
	email: string,
	role: TeamRole,
): Promise<{ id: string; role: TeamRole; email: string }> =>
	legacyFetch("/team/invite", {
		body: JSON.stringify({ email, role, site_id: siteId }),
		method: "POST",
	});

export const updateTeamMemberRole = (memberId: string, role: TeamRole): Promise<void> =>
	legacyFetch(`/team/${memberId}`, {
		body: JSON.stringify({ role }),
		method: "PATCH",
	});

export const removeTeamMember = (memberId: string): Promise<void> =>
	legacyFetch(`/team/${memberId}`, { method: "DELETE" });

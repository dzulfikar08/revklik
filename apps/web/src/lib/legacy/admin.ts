/**
 * Client endpoints for the admin view (super_admin only on the worker side).
 */
import { legacyFetch } from "./api";

export interface AdminSite {
	id: string;
	domain: string;
	created_at: string;
}

export interface AdminMember {
	id: string;
	email: string;
	name: string;
	role: string;
	created_at: string;
	plan: string;
	subscription_status: string;
	period_end: string | null;
	awaiting_payment: boolean;
	sites: AdminSite[];
	events_total: number;
	events_last_30d: number;
	last_event_at: string | null;
}

export const fetchMembers = (): Promise<AdminMember[]> => legacyFetch("/admin/members");

export const runBackup = (): Promise<{ success: boolean }> =>
	legacyFetch("/admin/backup", { method: "POST" });

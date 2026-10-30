/**
 * Data-subject and account deletion endpoints: delete one visitor's data,
 * export it, and delete the whole account. Same envelope as the rest of the
 * klikapa API; errors keep their machine code on `LegacyApiError.code`.
 */
import { forgetToken } from "./account-tokens";
import {
	getLegacyUser,
	getToken,
	LEGACY_API_BASE,
	LegacyApiError,
	legacyFetch,
	legacyLogout,
	readableError,
} from "./api";
import type { LegacyErrorBody } from "./api";

export interface VisitorDeletionCounts {
	events: number;
	sessions: number;
	profiles: number;
	recordings: number;
	heatmap_rows: number;
	payments_anonymized: number;
}

export interface VisitorExport {
	profile: unknown;
	sessions: unknown[];
	events: unknown[];
}

const visitorPath = (siteId: string, visitorId: string): string =>
	`/sites/${encodeURIComponent(siteId)}/visitors/${encodeURIComponent(visitorId)}`;

/** Erase one visitor from a site. Payment events stay, anonymised. */
export const deleteVisitorData = (
	siteId: string,
	visitorId: string,
): Promise<VisitorDeletionCounts> =>
	legacyFetch(visitorPath(siteId, visitorId), { method: "DELETE" });

/** Everything stored about one visitor, for an access request. */
export const exportVisitorData = (siteId: string, visitorId: string): Promise<VisitorExport> =>
	legacyFetch(`${visitorPath(siteId, visitorId)}/export`);

/** Wait between repeat calls while a large account is still being purged. */
export const ACCOUNT_DELETE_DELAY_MS = 1000;
export const ACCOUNT_DELETE_MAX_ATTEMPTS = 30;

/** The server was still purging when the retry cap was reached. */
export class AccountDeleteTimeoutError extends Error {
	constructor() {
		super("Account deletion is still running");
		this.name = "AccountDeleteTimeoutError";
	}
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * DELETE /auth/account. 200 means the account is gone and the session is dead;
 * 202 means a big account still has tables to purge, so the same request is
 * repeated until the final 200. Local session state is dropped on success.
 */
export const deleteAccount = async (
	input: { confirmEmail: string; currentPassword?: string },
	{
		delayMs = ACCOUNT_DELETE_DELAY_MS,
		maxAttempts = ACCOUNT_DELETE_MAX_ATTEMPTS,
	}: { delayMs?: number; maxAttempts?: number } = {},
): Promise<void> => {
	const me = getLegacyUser();
	const body = JSON.stringify({
		confirm_email: input.confirmEmail,
		...(input.currentPassword ? { current_password: input.currentPassword } : {}),
	});
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const token = await getToken();
		// oxlint-disable-next-line no-await-in-loop -- each call continues the purge
		const res = await fetch(`${LEGACY_API_BASE}/auth/account`, {
			body,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			method: "DELETE",
		});
		if (res.status === 200) {
			legacyLogout();
			if (me) {
				forgetToken(localStorage, me.id);
			}
			return;
		}
		if (res.status === 202) {
			if (attempt < maxAttempts) {
				// oxlint-disable-next-line no-await-in-loop -- deliberate backoff
				await sleep(delayMs);
			}
			continue;
		}
		const err = (await res.json?.().catch(() => null)) as LegacyErrorBody | null | undefined;
		throw new LegacyApiError(
			readableError(err?.error) ?? `Request failed (${res.status})`,
			res.status,
			err ?? undefined,
		);
	}
	throw new AccountDeleteTimeoutError();
};

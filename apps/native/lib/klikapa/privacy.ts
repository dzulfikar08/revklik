/**
 * Account deletion: DELETE /auth/account (apps/app worker routes/privacy.ts).
 * 200 = the account is gone and the session is dead; 202 = a large account still
 * has tables to purge, so the same request repeats until the final 200.
 */
import { t } from "../i18n";
import { forgetToken } from "./account-tokens";
import { API_URL, getLegacyUser, getToken, LegacyApiError, legacyLogout } from "./api";

const RETRY_DELAY_MS = 1000;
const MAX_ATTEMPTS = 30;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const errorFor = (status: number, error: string | undefined): LegacyApiError => {
	const map: Record<string, Parameters<typeof t>[0]> = {
		billing_cancel_failed: "err.billingCancel",
		confirm_email_mismatch: "err.emailMismatch",
		current_password_invalid: "err.passwordInvalid",
		recent_login_required: "err.recentLogin",
		too_many_attempts: "err.rateLimited",
	};
	const key = error ? map[error] : undefined;
	return new LegacyApiError(key ? t(key) : t("account.deleteFailed"), status, error);
};

/**
 * Delete the signed-in account. `currentPassword` is optional: a Google-only
 * account has none and instead needs a login from the last 10 minutes.
 * Local session state is dropped on success; the caller resets the auth store.
 */
export const deleteAccount = async (input: {
	confirmEmail: string;
	currentPassword?: string;
}): Promise<void> => {
	const me = await getLegacyUser();
	const body = JSON.stringify({
		confirm_email: input.confirmEmail,
		...(input.currentPassword ? { current_password: input.currentPassword } : {}),
	});
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		const token = await getToken();
		// Each call continues the purge, so they cannot run in parallel.
		// oxlint-disable-next-line no-await-in-loop -- sequential by design
		const res = await fetch(`${API_URL}/auth/account`, {
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
				// oxlint-disable-next-line no-await-in-loop -- sequential by design
				await forgetToken(me.id);
			}
			return;
		}
		if (res.status === 202) {
			// oxlint-disable-next-line no-await-in-loop -- sequential by design
			await sleep(RETRY_DELAY_MS);
			continue;
		}
		// oxlint-disable-next-line no-await-in-loop -- sequential by design
		const json = (await res.json().catch(() => null)) as { error?: string } | null;
		throw errorFor(res.status, json?.error);
	}
	throw new LegacyApiError(t("account.deleteRunning"), 202);
};

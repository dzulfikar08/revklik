import type { MessageKey } from "./i18n";
import { LegacyApiError, readableError } from "./legacy/api";

/**
 * What to show under the auth form after a failed sign-in or sign-up:
 * throttling (429 too_many_attempts) gets its own message, server prose
 * ("Invalid credentials") is shown as is, and error codes or 5xx fall back
 * to a generic line.
 */
export const authErrorMessage = (
	err: unknown,
	signUp: boolean,
	t: (key: MessageKey) => string,
): string => {
	if (err instanceof LegacyApiError && err.status === 429) {
		return t("auth.throttled");
	}
	if (err instanceof LegacyApiError && err.status < 500 && readableError(err.message)) {
		return err.message;
	}
	return signUp ? t("auth.signUpError") : t("auth.error");
};

import type { MessageKey } from "./i18n";
import { LegacyApiError } from "./legacy/api";

const SERVER_ERROR = 500;
const TOO_MANY = 429;

/** Plain-language cause for a failed load; never the raw fetch message. */
export const loadErrorKey = (error: unknown): MessageKey => {
	if (error instanceof LegacyApiError) {
		if (error.status === TOO_MANY) {
			return "state.errorBusy";
		}
		if (error.status >= SERVER_ERROR) {
			return "state.errorServer";
		}
		return "state.errorGeneric";
	}
	if (error instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
		return "state.errorOffline";
	}
	return "state.errorGeneric";
};

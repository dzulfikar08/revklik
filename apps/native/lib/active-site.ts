/**
 * Active-site selection, persisted via SecureStore like the web app's
 * `kp_active_site` localStorage key (cleared on sign-out by legacyLogout).
 */
import { useSyncExternalStore } from "react";

import { getActiveSiteId, setActiveSiteId } from "./klikapa/api";

let siteId: string | null = null;
const listeners: (() => void)[] = [];

const emit = (): void => {
	for (const l of listeners) {
		l();
	}
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.push(listener);
	return () => {
		listeners.splice(listeners.indexOf(listener), 1);
	};
};

const getSnapshot = (): string | null => siteId;

/** Cold start: restore the last-viewed site. */
export const initActiveSite = async (): Promise<void> => {
	siteId = await getActiveSiteId();
	emit();
};

/** Select a site (and remember it across restarts). */
export const selectActiveSite = (id: string): void => {
	siteId = id;
	emit();
	void setActiveSiteId(id);
};

export const useActiveSite = (): string | null => useSyncExternalStore(subscribe, getSnapshot);

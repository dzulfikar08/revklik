/**
 * klikapa session store for the native app.
 * Backed by lib/klikapa/api.ts (expo-secure-store persistence), exposed as a
 * tiny external store so any component can `useAuth()` without providers.
 */
import { useSyncExternalStore } from "react";

import {
	completeGoogleSignIn,
	getLegacyUser,
	getToken,
	legacyLogin,
	legacyLogout,
	legacyRegister,
	legacySignOut,
} from "./klikapa/api";
import type { LegacyUser } from "./klikapa/api";
import { continueAsRemembered, switchAccount } from "./klikapa/accounts";
import type { LinkedUser } from "./klikapa/accounts";
import { resetActiveSite } from "./active-site";
import { registerForPush, unregisterFromPush } from "./push";

export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface AuthState {
	status: AuthStatus;
	user: LegacyUser | null;
}

let state: AuthState = { status: "loading", user: null };
const listeners: (() => void)[] = [];

const setState = (next: AuthState): void => {
	state = next;
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

const getSnapshot = (): AuthState => state;

/** Cold start: restore the persisted klikapa session (if any). */
export const initAuth = async (): Promise<void> => {
	const [token, user] = await Promise.all([getToken(), getLegacyUser()]);
	setState(token && user ? { status: "signed-in", user } : { status: "signed-out", user: null });
};

export const authSignIn = async (email: string, password: string): Promise<void> => {
	const user = await legacyLogin(email, password);
	setState({ status: "signed-in", user });
};

export const authRegister = async (
	name: string,
	email: string,
	password: string,
): Promise<void> => {
	const user = await legacyRegister(name, email, password);
	setState({ status: "signed-in", user });
};

/** Complete a Google OAuth flow that landed back in the app with a token. */
export const authCompleteGoogle = async (token: string): Promise<void> => {
	const user = await completeGoogleSignIn(token);
	setState({ status: "signed-in", user });
};

/**
 * Switch to a linked account. Push registration is per account: this device
 * is released from the current account first (needs the live session), and
 * the root layout registers it for the new user once the store updates.
 * Callers clear the React Query cache afterwards.
 */
export const authSwitchAccount = async (target: LinkedUser): Promise<void> => {
	await unregisterFromPush();
	let user: LegacyUser;
	try {
		user = await switchAccount(target);
	} catch (error) {
		// Still the same account: put this device's alerts back.
		registerForPush().catch(() => undefined);
		throw error;
	}
	resetActiveSite();
	setState({ status: "signed-in", user });
};

/** Sign-in screen shortcut: reuse a session this device still holds. */
export const authContinueAs = async (remembered: LegacyUser): Promise<void> => {
	if (await continueAsRemembered(remembered)) {
		resetActiveSite();
		setState({ status: "signed-in", user: remembered });
	}
};

export const authSignOut = async ({ keepOthers = false } = {}): Promise<void> => {
	// Needs the live session, so it must run before the token is dropped.
	await unregisterFromPush();
	await legacySignOut({ keepOthers });
	setState({ status: "signed-out", user: null });
};

/**
 * After DELETE /auth/account succeeded: the account and its session are gone
 * server-side (the push device row went with it), so only local state is left.
 */
export const authAccountDeleted = (): void => {
	resetActiveSite();
	legacyLogout();
	setState({ status: "signed-out", user: null });
};

/** Called when an API call answers 401 — the persisted token is dead. */
export const authSessionExpired = (): void => {
	legacyLogout();
	setState({ status: "signed-out", user: null });
};

export const useAuth = (): AuthState => useSyncExternalStore(subscribe, getSnapshot);

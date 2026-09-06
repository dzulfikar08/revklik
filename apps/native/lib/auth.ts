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
  setState(
    token && user
      ? { status: "signed-in", user }
      : { status: "signed-out", user: null }
  );
};

export const authSignIn = async (
  email: string,
  password: string
): Promise<void> => {
  const user = await legacyLogin(email, password);
  setState({ status: "signed-in", user });
};

export const authRegister = async (
  name: string,
  email: string,
  password: string
): Promise<void> => {
  const user = await legacyRegister(name, email, password);
  setState({ status: "signed-in", user });
};

/** Complete a Google OAuth flow that landed back in the app with a token. */
export const authCompleteGoogle = async (token: string): Promise<void> => {
  const user = await completeGoogleSignIn(token);
  setState({ status: "signed-in", user });
};

export const authSignOut = async (): Promise<void> => {
  await legacySignOut();
  setState({ status: "signed-out", user: null });
};

/** Called when an API call answers 401 — the persisted token is dead. */
export const authSessionExpired = (): void => {
  legacyLogout();
  setState({ status: "signed-out", user: null });
};

export const useAuth = (): AuthState =>
  useSyncExternalStore(subscribe, getSnapshot);

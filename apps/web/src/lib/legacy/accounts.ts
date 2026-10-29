/**
 * Linked accounts: list, link (password or Google), unlink, switch. The
 * server owns the links (GET/POST /auth/links, DELETE /auth/links/:id,
 * POST /auth/switch); this module adds the browser-side token reuse.
 */
import { forgetToken, getRememberedToken, pruneTokens, readTokenMap } from "./account-tokens";
import {
	LEGACY_API_BASE,
	LegacyApiError,
	getLegacyUser,
	getToken,
	legacyFetch,
	setLegacySession,
} from "./api";
import type { LegacyUser } from "./api";

export interface LinkedUser {
	id: string;
	name: string;
	email: string;
	avatar_url: string | null;
}

export interface AccountLink {
	id: string;
	user: LinkedUser;
	created_at: string;
}

/** Most links one account can hold (enforced by the worker). */
export const MAX_LINKS = 5;

export const LINKS_QUERY_KEY = ["legacy", "account-links"] as const;

/** Linked accounts of the signed-in user; also drops tokens of accounts no longer linked. */
export const fetchLinks = async (): Promise<AccountLink[]> => {
	const links = await legacyFetch<AccountLink[]>("/auth/links");
	const me = getLegacyUser();
	if (me) {
		pruneTokens(localStorage, [me.id, ...links.map((l) => l.user.id)]);
	}
	return links;
};

/**
 * A wrong password answers 401, which legacyFetch treats as a dead session
 * and signs out; this call reads the response itself so the caller stays
 * signed in and sees the code (invalid, too_many_attempts, already_linked…).
 */
export const linkWithPassword = async (email: string, password: string): Promise<AccountLink> => {
	const token = await getToken();
	const res = await fetch(`${LEGACY_API_BASE}/auth/links`, {
		body: JSON.stringify({ email, password }),
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		method: "POST",
	});
	const json = (await res.json().catch(() => null)) as {
		data?: AccountLink;
		error?: string;
		success?: boolean;
	} | null;
	if (!res.ok || !json?.success || !json.data) {
		throw new LegacyApiError(`Request failed (${res.status})`, res.status, {
			error: json?.error === "Invalid credentials" ? "invalid_credentials" : json?.error,
		});
	}
	return json.data;
};

export const unlinkAccount = async (link: AccountLink): Promise<void> => {
	await legacyFetch(`/auth/links/${link.id}`, { method: "DELETE" });
	forgetToken(localStorage, link.user.id);
};

/** Ask for a one-time intent, then send the browser through Google in link mode. */
export const startGoogleLink = async (returnTo: string): Promise<void> => {
	const { intent } = await legacyFetch<{ intent: string }>("/auth/links/google-intent", {
		method: "POST",
	});
	const params = new URLSearchParams({ link: intent, redirect_to: returnTo });
	window.location.assign(`${LEGACY_API_BASE}/auth/google?${params.toString()}`);
};

const tokenWorks = async (token: string, userId: string): Promise<LegacyUser | null> => {
	try {
		const res = await fetch(`${LEGACY_API_BASE}/auth/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as { data?: { user?: LegacyUser } };
		return json.data?.user?.id === userId ? json.data.user : null;
	} catch {
		return null;
	}
};

/**
 * Make `target` the active account. The link must still exist server-side;
 * then a live remembered token is reused, else /auth/switch mints a new
 * session (the current one stays valid so switching back is instant).
 */
export const switchAccount = async (target: LinkedUser): Promise<void> => {
	const links = await fetchLinks();
	if (!links.some((l) => l.user.id === target.id)) {
		throw new LegacyApiError("This account is no longer linked", 403);
	}
	const remembered = getRememberedToken(localStorage, target.id);
	if (remembered) {
		const user = await tokenWorks(remembered, target.id);
		if (user) {
			setLegacySession(remembered, user);
			clearAccountScopedState();
			return;
		}
		forgetToken(localStorage, target.id);
	}
	const minted = await legacyFetch<{ token: string; user: LegacyUser }>("/auth/switch", {
		body: JSON.stringify({ user_id: target.id }),
		method: "POST",
	});
	setLegacySession(minted.token, minted.user);
	clearAccountScopedState();
};

/** Site ids belong to one account. */
const clearAccountScopedState = (): void => {
	localStorage.removeItem("kp_active_site");
};

/** Signed-in accounts this browser still holds a token for, other than the current one. */
export const rememberedOtherUserIds = (): string[] => {
	const me = getLegacyUser();
	return Object.keys(readTokenMap(localStorage)).filter((id) => id !== me?.id);
};

/** Reload into the dashboard so every query, cache and open view starts clean. */
export const enterDashboard = (): void => {
	window.location.assign("/analytics");
};

/** Users whose remembered token still works (dead tokens are dropped). */
export const fetchRememberedAccounts = async (): Promise<LegacyUser[]> => {
	const entries = Object.entries(readTokenMap(localStorage));
	const checked = await Promise.all(
		entries.map(async ([id, token]) => {
			const user = await tokenWorks(token, id);
			if (!user) {
				forgetToken(localStorage, id);
			}
			return user;
		}),
	);
	return checked.filter((u): u is LegacyUser => u !== null);
};

/** Sign back in as a remembered account without a password. */
export const continueAsRemembered = (user: LegacyUser): boolean => {
	const token = getRememberedToken(localStorage, user.id);
	if (!token) {
		return false;
	}
	setLegacySession(token, user);
	clearAccountScopedState();
	return true;
};

/**
 * Linked accounts: list, link (password or Google), unlink, switch. The
 * server owns the links (GET/POST /auth/links, DELETE /auth/links/:id,
 * POST /auth/switch); this module adds on-device token reuse. Mirrors
 * apps/web/src/lib/legacy/accounts.ts.
 */
import { forgetToken, getRememberedToken, pruneTokens, readTokenMap } from "./account-tokens";
import {
	API_URL,
	getLegacyUser,
	getToken,
	LegacyApiError,
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

const LINK_ERROR_MESSAGES: Record<string, string> = {
	already_linked: "These accounts are already linked.",
	expired: "The Google link request expired. Try again.",
	invalid_credentials: "Wrong email or password.",
	limit_reached: `An account can have up to ${MAX_LINKS} links.`,
	no_account: "No RevKlik account uses that Google address. Sign up with it first, then link it.",
	self: "That is the account you are signed in to.",
	too_many_attempts: "Too many attempts. Wait a few minutes, then try again.",
};

export const linkErrorMessage = (code: string | undefined): string =>
	(code ? LINK_ERROR_MESSAGES[code] : undefined) ?? "Couldn't link the account. Try again.";

/** Error carrying the worker's machine-readable code (already_linked, …). */
export class LinkError extends Error {
	code: string | undefined;
	constructor(code: string | undefined) {
		super(linkErrorMessage(code));
		this.name = "LinkError";
		this.code = code;
	}
}

/** Linked accounts of the signed-in user; also drops tokens of accounts no longer linked. */
export const fetchLinks = async (): Promise<AccountLink[]> => {
	const links = await legacyFetch<AccountLink[]>("/auth/links");
	const me = await getLegacyUser();
	if (me) {
		await pruneTokens([me.id, ...links.map((l) => l.user.id)]);
	}
	return links;
};

/**
 * A wrong password answers 401, which the shared request helper treats as a
 * dead session and signs out; this call reads the response itself so the
 * user stays signed in and sees the code.
 */
export const linkWithPassword = async (email: string, password: string): Promise<AccountLink> => {
	const token = await getToken();
	const res = await fetch(`${API_URL}/auth/links`, {
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
		throw new LinkError(
			json?.error === "Invalid credentials" ? "invalid_credentials" : json?.error,
		);
	}
	return json.data;
};

export const unlinkAccount = async (link: AccountLink): Promise<void> => {
	await legacyFetch(`/auth/links/${link.id}`, { method: "DELETE" });
	await forgetToken(link.user.id);
};

/** Start URL for Google in link mode; resolves with `revklik://auth/callback?link=ok|error`. */
export const googleLinkUrl = async (callbackUrl: string): Promise<string> => {
	const { intent } = await legacyFetch<{ intent: string }>("/auth/links/google-intent", {
		method: "POST",
	});
	const params = new URLSearchParams({ link: intent, redirect_to: callbackUrl });
	return `${API_URL}/auth/google?${params.toString()}`;
};

/** Read link=ok|error&reason=… off the deep link the Google flow returned to. */
export const parseLinkResult = (url: string): { ok: boolean; reason: string | undefined } => {
	const query = (url.split("#")[0] ?? "").split("?")[1] ?? "";
	const params = new URLSearchParams(query);
	return { ok: params.get("link") === "ok", reason: params.get("reason") ?? undefined };
};

const userForToken = async (token: string, userId: string): Promise<LegacyUser | null> => {
	try {
		const res = await fetch(`${API_URL}/auth/me`, {
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
export const switchAccount = async (target: LinkedUser): Promise<LegacyUser> => {
	const links = await fetchLinks();
	if (!links.some((l) => l.user.id === target.id)) {
		throw new LegacyApiError("This account is no longer linked", 403);
	}
	const remembered = await getRememberedToken(target.id);
	if (remembered) {
		const user = await userForToken(remembered, target.id);
		if (user) {
			await setLegacySession(remembered, user);
			return user;
		}
		await forgetToken(target.id);
	}
	const minted = await legacyFetch<{ token: string; user: LegacyUser }>("/auth/switch", {
		body: JSON.stringify({ user_id: target.id }),
		method: "POST",
	});
	await setLegacySession(minted.token, minted.user);
	return minted.user;
};

/** Users whose remembered token still works (dead tokens are dropped). */
export const fetchRememberedAccounts = async (): Promise<LegacyUser[]> => {
	const entries = Object.entries(await readTokenMap());
	const checked = await Promise.all(
		entries.map(async ([id, token]) => {
			const user = await userForToken(token, id);
			if (!user) {
				await forgetToken(id);
			}
			return user;
		}),
	);
	return checked.filter((u): u is LegacyUser => u !== null);
};

/** Sign back in as a remembered account without a password. */
export const continueAsRemembered = async (user: LegacyUser): Promise<boolean> => {
	const token = await getRememberedToken(user.id);
	if (!token) {
		return false;
	}
	await setLegacySession(token, user);
	return true;
};

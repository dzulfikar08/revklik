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
	current_password_invalid: "Your password is wrong.",
	recent_login_required: "Sign in again, then link an account within 10 minutes.",
	unverified: "That account's email address is not verified yet.",
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
 * POST that reads the response itself: a 401 from the shared request helper
 * signs the app out, but here it only means a wrong password. Errors carry
 * the worker's code (invalid_credentials, current_password_invalid, …).
 */
const postLinkRequest = async <T>(path: string, body: Record<string, string>): Promise<T> => {
	const token = await getToken();
	const res = await fetch(`${API_URL}${path}`, {
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		method: "POST",
	});
	const json = (await res.json().catch(() => null)) as {
		data?: T;
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

export const linkWithPassword = (
	email: string,
	password: string,
	currentPassword: string,
): Promise<AccountLink> =>
	postLinkRequest("/auth/links", { current_password: currentPassword, email, password });

export const unlinkAccount = async (link: AccountLink): Promise<void> => {
	await legacyFetch(`/auth/links/${link.id}`, { method: "DELETE" });
	await forgetToken(link.user.id);
};

/** Start URL for Google in link mode; the flow returns to `callbackUrl#link_code=<code>`. */
export const googleLinkUrl = async (
	callbackUrl: string,
	currentPassword: string,
): Promise<string> => {
	const { intent } = await postLinkRequest<{ intent: string }>("/auth/links/google-intent", {
		current_password: currentPassword,
	});
	const params = new URLSearchParams({ link: intent, redirect_to: callbackUrl });
	return `${API_URL}/auth/google?${params.toString()}`;
};

/** What the deep link carried: a one-time code on success, or link=error&reason=…. */
export const parseLinkResult = (
	url: string,
): { code: string | null; reason: string | undefined } => {
	const [beforeHash = "", fragment = ""] = url.split("#");
	const query = new URLSearchParams(beforeHash.split("?")[1] ?? "");
	const code = new URLSearchParams(fragment).get("link_code");
	return { code, reason: query.get("reason") ?? undefined };
};

/** Which account a Google link code would attach (nothing is linked yet). */
export const previewGoogleLink = async (code: string): Promise<LinkedUser> =>
	(await postLinkRequest<{ user: LinkedUser }>("/auth/links/google/preview", { code })).user;

/** Confirm a previewed Google link; only the session that started the flow may. */
export const completeGoogleLink = (code: string): Promise<AccountLink> =>
	postLinkRequest("/auth/links/google/complete", { code });

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

/** Accounts deliberately kept signed in on this device whose token still works. */
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

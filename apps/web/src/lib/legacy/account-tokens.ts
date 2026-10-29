/**
 * Per-user session tokens kept in this browser so switching back to a linked
 * account reuses a live session instead of minting a new one. Stored as
 * `{ [userId]: token }` under kp_tokens.
 */

export const TOKENS_KEY = "kp_tokens";

export type TokenMap = Record<string, string>;

type TokenStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const isTokenMap = (value: unknown): value is TokenMap =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	Object.values(value).every((token) => typeof token === "string" && token.length > 0);

export const readTokenMap = (storage: TokenStorage): TokenMap => {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(TOKENS_KEY) ?? "{}");
		return isTokenMap(parsed) ? parsed : {};
	} catch {
		return {};
	}
};

const writeTokenMap = (storage: TokenStorage, map: TokenMap): void => {
	if (Object.keys(map).length === 0) {
		storage.removeItem(TOKENS_KEY);
		return;
	}
	storage.setItem(TOKENS_KEY, JSON.stringify(map));
};

export const rememberToken = (storage: TokenStorage, userId: string, token: string): void => {
	writeTokenMap(storage, { ...readTokenMap(storage), [userId]: token });
};

export const forgetToken = (storage: TokenStorage, userId: string): void => {
	const { [userId]: _dropped, ...rest } = readTokenMap(storage);
	writeTokenMap(storage, rest);
};

export const getRememberedToken = (storage: TokenStorage, userId: string): string | null =>
	readTokenMap(storage)[userId] ?? null;

/** Keep only the listed users (the current account and its live links). */
export const pruneTokens = (storage: TokenStorage, keepUserIds: readonly string[]): void => {
	const keep = new Set(keepUserIds);
	const map = readTokenMap(storage);
	const kept = Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
	if (Object.keys(kept).length !== Object.keys(map).length) {
		writeTokenMap(storage, kept);
	}
};

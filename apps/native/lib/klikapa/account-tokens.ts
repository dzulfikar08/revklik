/**
 * Per-user session tokens kept on this device (SecureStore `kp_tokens`,
 * `{ [userId]: token }`) so switching back to a linked account reuses a live
 * session instead of minting a new one. Mirrors apps/web/src/lib/legacy/account-tokens.ts.
 */
import * as SecureStore from "expo-secure-store";

const TOKENS_KEY = "kp_tokens";

export type TokenMap = Record<string, string>;

export const parseTokenMap = (raw: string | null): TokenMap => {
	if (!raw) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		const entries = Object.entries(parsed).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
		);
		return Object.fromEntries(entries);
	} catch {
		return {};
	}
};

export const readTokenMap = async (): Promise<TokenMap> => {
	try {
		return parseTokenMap(await SecureStore.getItemAsync(TOKENS_KEY));
	} catch {
		return {};
	}
};

const writeTokenMap = async (map: TokenMap): Promise<void> => {
	try {
		if (Object.keys(map).length === 0) {
			await SecureStore.deleteItemAsync(TOKENS_KEY);
			return;
		}
		await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(map));
	} catch {
		// Not persisted; switching falls back to minting a session.
	}
};

export const rememberToken = async (userId: string, token: string): Promise<void> => {
	await writeTokenMap({ ...(await readTokenMap()), [userId]: token });
};

export const forgetToken = async (userId: string): Promise<void> => {
	const { [userId]: _dropped, ...rest } = await readTokenMap();
	await writeTokenMap(rest);
};

export const getRememberedToken = async (userId: string): Promise<string | null> =>
	(await readTokenMap())[userId] ?? null;

/** Keep only the listed users (the current account and its live links). */
export const pruneTokens = async (keepUserIds: readonly string[]): Promise<void> => {
	const keep = new Set(keepUserIds);
	const map = await readTokenMap();
	const kept = Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
	if (Object.keys(kept).length !== Object.keys(map).length) {
		await writeTokenMap(kept);
	}
};

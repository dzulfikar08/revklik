import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const isNative = Capacitor.isNativePlatform();

/** Sync read — works for web (localStorage). On native, returns cached value or null. */
export function getItemSync(key: string): string | null {
	return localStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
	localStorage.setItem(key, value);
	if (isNative) await Preferences.set({ key, value });
}

export async function getItem(key: string): Promise<string | null> {
	if (isNative) {
		const { value } = await Preferences.get({ key });
		return value;
	}
	return localStorage.getItem(key);
}

export async function removeItem(key: string): Promise<void> {
	localStorage.removeItem(key);
	if (isNative) await Preferences.remove({ key });
}

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const isNative = Capacitor.isNativePlatform();
/** Sync read — works for web (localStorage). On native, returns cached value or null. */
export function getItemSync(key) {
	return localStorage.getItem(key);
}
export async function setItem(key, value) {
	localStorage.setItem(key, value);
	if (isNative) await Preferences.set({ key, value });
}
export async function getItem(key) {
	if (isNative) {
		const { value } = await Preferences.get({ key });
		return value;
	}
	return localStorage.getItem(key);
}
export async function removeItem(key) {
	localStorage.removeItem(key);
	if (isNative) await Preferences.remove({ key });
}

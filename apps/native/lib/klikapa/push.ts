/**
 * Push endpoints on the RevKlik Worker (session auth, /api/push/*):
 * device registration, sale/refund preferences and a test notification.
 */
import { bareFetch } from "./api";

export interface PushPrefs {
	sales: boolean;
	refunds: boolean;
}

export interface PushDeviceInput {
	expo_token: string;
	platform: "ios" | "android";
	locale?: string;
	app_version?: string;
}

export const registerPushDevice = (device: PushDeviceInput): Promise<{ success: boolean }> =>
	bareFetch("/push/devices", { body: JSON.stringify(device), method: "POST" });

export const unregisterPushDevice = (expoToken: string): Promise<{ success: boolean }> =>
	bareFetch("/push/devices", {
		body: JSON.stringify({ expo_token: expoToken }),
		method: "DELETE",
	});

export const fetchPushPrefs = (): Promise<PushPrefs> => bareFetch("/push/prefs");

export const updatePushPrefs = (prefs: Partial<PushPrefs>): Promise<PushPrefs> =>
	bareFetch("/push/prefs", { body: JSON.stringify(prefs), method: "PUT" });

export const sendTestPush = (): Promise<{ sent: number; tickets: unknown[] }> =>
	bareFetch("/push/test", { method: "POST" });

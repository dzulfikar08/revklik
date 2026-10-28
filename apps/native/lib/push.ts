/**
 * Expo push notifications: permission, Expo push token (needs the EAS
 * projectId from app.json), device registration with the RevKlik Worker and
 * notification-tap routing. The registration state is exposed as a tiny
 * external store so screens can show it without providers.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { registerPushDevice, unregisterPushDevice } from "./klikapa/push";

export const SALES_CHANNEL_ID = "sales";

const PUSH_TOKEN_KEY = "rk_push_token";

export type PushStatus =
	| "idle"
	| "registering"
	| "registered"
	| "permission-denied"
	| "unsupported"
	| "error";

export interface PushState {
	status: PushStatus;
	/** Human-readable reason for `error` / `permission-denied` / `unsupported`. */
	message: string | null;
}

/** Thrown for conditions the user (or the build config) must fix. */
export class PushError extends Error {
	status: Exclude<PushStatus, "idle" | "registering" | "registered">;
	constructor(status: PushError["status"], message: string) {
		super(message);
		this.name = "PushError";
		this.status = status;
	}
}

let state: PushState = { message: null, status: "idle" };
const listeners: (() => void)[] = [];

const setState = (next: PushState): void => {
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

export const usePushState = (): PushState => useSyncExternalStore(subscribe, () => state);

/** Foreground presentation + the high-importance Android channel the server targets. */
export const configureNotifications = async (): Promise<void> => {
	Notifications.setNotificationHandler({
		handleNotification: async () => ({
			shouldPlaySound: true,
			shouldSetBadge: false,
			shouldShowBanner: true,
			shouldShowList: true,
		}),
	});
	if (Platform.OS === "android") {
		await Notifications.setNotificationChannelAsync(SALES_CHANNEL_ID, {
			importance: Notifications.AndroidImportance.HIGH,
			name: "Sales and refunds",
			showBadge: false,
			sound: "default",
			vibrationPattern: [0, 250, 250, 250],
		});
	}
};

const easProjectId = (): string => {
	const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
	const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
	if (!projectId) {
		throw new PushError(
			"error",
			"Push setup is incomplete: extra.eas.projectId is missing from app.json, so no Expo push token can be requested.",
		);
	}
	return projectId;
};

const ensurePermission = async (): Promise<void> => {
	const current = await Notifications.getPermissionsAsync();
	if (current.granted) {
		return;
	}
	if (current.canAskAgain) {
		const asked = await Notifications.requestPermissionsAsync();
		if (asked.granted) {
			return;
		}
	}
	throw new PushError(
		"permission-denied",
		"Notifications are turned off for RevKlik. Enable them in system settings to get sale alerts.",
	);
};

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : "Unknown push registration error";

/**
 * Ask for permission, fetch the Expo push token and register it for the
 * signed-in user. Safe to call repeatedly (the server upserts by token).
 */
export const registerForPush = async (): Promise<void> => {
	setState({ message: null, status: "registering" });
	try {
		if (!Device.isDevice) {
			throw new PushError("unsupported", "Push notifications need a physical device.");
		}
		const projectId = easProjectId();
		await configureNotifications();
		await ensurePermission();
		const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
		await registerPushDevice({
			app_version: Constants.expoConfig?.version,
			expo_token: token,
			locale: Intl.DateTimeFormat().resolvedOptions().locale,
			platform: Platform.OS === "ios" ? "ios" : "android",
		});
		await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
		setState({ message: null, status: "registered" });
	} catch (error) {
		setState({
			message: describe(error),
			status: error instanceof PushError ? error.status : "error",
		});
		throw error;
	}
};

/** Sign-out: stop pushes to this device. Best effort; local state is cleared regardless. */
export const unregisterFromPush = async (): Promise<void> => {
	const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
	setState({ message: null, status: "idle" });
	if (!token) {
		return;
	}
	try {
		await unregisterPushDevice(token);
	} catch {
		// Offline or session already dead; the server prunes unregistered tokens on delivery.
	}
	await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => undefined);
};

/** True when a notification response is a plain tap (not a dismiss or custom action). */
export const isDefaultTap = (response: Notifications.NotificationResponse): boolean =>
	response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;

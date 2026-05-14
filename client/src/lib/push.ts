import { Capacitor } from "@capacitor/core";
import type { Token, ActionPerformed } from "@capacitor/push-notifications";

export async function initPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  // Request permission
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return;

  // Register with APNs/FCM
  await PushNotifications.register();

  // On token received, send to server
  PushNotifications.addListener("registration", async (token: Token) => {
    const stored = await import("@/lib/mobile-storage").then((m) => m.getItem("kp_token"));
    if (!stored) return;
    try {
      await fetch(`${import.meta.env.VITE_API_BASE || "https://klikapa.app/api"}/push-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored}` },
        body: JSON.stringify({ device_token: token.value, platform: Capacitor.getPlatform() }),
      });
    } catch { /* retry later */ }
  });

  // Handle notification tap — navigate to site
  PushNotifications.addListener("pushNotificationActionPerformed", (action: ActionPerformed) => {
    const data = action.notification.data;
    if (data?.site_id) {
      import("@/lib/api").then(({ setActiveSiteId }) => {
        setActiveSiteId(data.site_id);
      });
    }
  });
}

export async function unregisterPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.removeAllListeners();
}

import { Capacitor } from "@capacitor/core";
// Set to true once google-services.json / GoogleService-Info.plist is added to the native project
const FCM_CONFIGURED = false;
export async function initPushNotifications() {
    if (!Capacitor.isNativePlatform() || !FCM_CONFIGURED)
        return;
    try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted")
            return;
        await PushNotifications.register();
        PushNotifications.addListener("registration", async (token) => {
            const stored = await import("@/lib/mobile-storage").then((m) => m.getItem("kp_token"));
            if (!stored)
                return;
            try {
                await fetch(`${import.meta.env.VITE_API_BASE || "https://app.revklik.com/api"}/push-tokens`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored}` },
                    body: JSON.stringify({ device_token: token.value, platform: Capacitor.getPlatform() }),
                });
            }
            catch { /* retry later */ }
        });
        PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            const data = action.notification.data;
            if (data?.site_id) {
                import("@/lib/api").then(({ setActiveSiteId }) => {
                    setActiveSiteId(data.site_id);
                });
            }
        });
    }
    catch (e) {
        console.warn("Push notifications init failed:", e);
    }
}
export async function unregisterPush() {
    if (!Capacitor.isNativePlatform())
        return;
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.removeAllListeners();
}

import { registerPlugin } from "@capacitor/core";
import type { KlikapaWidgetBridgePlugin } from "./definitions";

const KlikapaWidgetBridge = registerPlugin<KlikapaWidgetBridgePlugin>("KlikapaWidgetBridge", {
	web: () => import("./web").then((m) => new m.KlikapaWidgetBridgeWeb()),
});

export * from "./definitions";
export { KlikapaWidgetBridge };

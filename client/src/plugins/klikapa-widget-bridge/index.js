import { registerPlugin } from "@capacitor/core";

const KlikapaWidgetBridge = registerPlugin("KlikapaWidgetBridge", {
	web: () => import("./web").then((m) => new m.KlikapaWidgetBridgeWeb()),
});

export * from "./definitions";
export { KlikapaWidgetBridge };

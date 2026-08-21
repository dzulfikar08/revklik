import type { KlikapaWidgetBridgePlugin, WidgetData } from "./definitions";

export class KlikapaWidgetBridgeWeb implements KlikapaWidgetBridgePlugin {
	async saveWidgetData(data: WidgetData): Promise<void> {
		// Web fallback: store in localStorage so PWA widgets can read
		localStorage.setItem("kp_widget_data", JSON.stringify(data));
	}
	async clearWidgetData(): Promise<void> {
		localStorage.removeItem("kp_widget_data");
	}
}

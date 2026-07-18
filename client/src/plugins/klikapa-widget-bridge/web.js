export class KlikapaWidgetBridgeWeb {
	async saveWidgetData(data) {
		// Web fallback: store in localStorage so PWA widgets can read
		localStorage.setItem("kp_widget_data", JSON.stringify(data));
	}
	async clearWidgetData() {
		localStorage.removeItem("kp_widget_data");
	}
}

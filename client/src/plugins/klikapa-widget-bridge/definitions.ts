export interface WidgetData {
  siteName: string;
  visitors: number;
  pageviews: number;
  trend: number;
  sparkline: number[];
  updatedAt: string;
}

export interface KlikapaWidgetBridgePlugin {
  saveWidgetData(data: WidgetData): Promise<void>;
  clearWidgetData(): Promise<void>;
}

/**
 * Dashboard sections addressable as ?view=…, kept out of analytics-page so
 * the route's search validation does not pull the dashboard into the
 * entry chunk.
 */
export const VIEW_KEYS = ["home", "settings", "share", "billing", "integrations", "admin"] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];

/** Unknown or missing values fall back to the home view. */
export const parseView = (value: unknown): ViewKey =>
	VIEW_KEYS.find((key) => key === value) ?? "home";

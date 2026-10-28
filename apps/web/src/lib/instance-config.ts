/**
 * Public instance config from the worker's `GET /api` (the same document the
 * health probes read). `self_hosted` hides everything that belongs to the
 * hosted product's own billing: pricing, upgrade prompts, the billing tab.
 *
 * The last answer is cached in localStorage so repeat visits render without
 * waiting for the request; the first visit waits for it (short timeout).
 */
import { LEGACY_API_BASE } from "./legacy/api";

const CACHE_KEY = "kp_instance";
const FETCH_TIMEOUT_MS = 3000;

interface InstanceConfig {
	selfHosted: boolean;
}

const readCache = (): InstanceConfig | null => {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		return raw === null ? null : { selfHosted: raw === "1" };
	} catch {
		return null;
	}
};

const writeCache = (config: InstanceConfig): void => {
	try {
		localStorage.setItem(CACHE_KEY, config.selfHosted ? "1" : "0");
	} catch {
		// Storage blocked: the answer only lives for this page view.
	}
};

let config: InstanceConfig = readCache() ?? { selfHosted: false };

/** True on instances running with SELF_HOSTED=1: no plans, limits or checkout. */
export const isSelfHosted = (): boolean => config.selfHosted;

const fetchConfig = async (): Promise<void> => {
	try {
		const res = await fetch(LEGACY_API_BASE, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			return;
		}
		const body = (await res.json()) as { self_hosted?: unknown };
		config = { selfHosted: body.self_hosted === true };
		writeCache(config);
	} catch {
		// Offline or an older worker: keep the cached/default answer.
	}
};

/** Resolve the config before first render (cached answer: refresh in the background). */
export const initInstanceConfig = async (): Promise<void> => {
	const refresh = fetchConfig();
	if (readCache() === null) {
		await refresh;
	}
};

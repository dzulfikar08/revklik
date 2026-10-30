/** Offline tests: chunked site deletion and the Growth plan-lock mapping. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_API_BASE, LegacyApiError, legacyLogout } from "./api";
import { fetchInsights, GrowthPlanLockedError } from "./growth";
import { deleteLegacySite, SiteDeleteTimeoutError } from "./sites";

const reply = (status: number, body: unknown = null) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

const deleting = () => reply(202, { status: "deleting", remaining_tables: ["events"] });

beforeEach(() => {
	localStorage.clear();
	legacyLogout();
	localStorage.setItem("kp_token", "kp_live");
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("deleteLegacySite", () => {
	it("repeats DELETE while the worker answers 202, resolves on the final 200", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(deleting())
			.mockResolvedValueOnce(deleting())
			.mockResolvedValueOnce(reply(200, { success: true }));
		vi.stubGlobal("fetch", fetch);

		await expect(deleteLegacySite("s1", { delayMs: 0 })).resolves.toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(3);
		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${LEGACY_API_BASE}/sites/s1`);
		expect(init.method).toBe("DELETE");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer kp_live");
	});

	it("accepts 204 as done", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(204)));
		await expect(deleteLegacySite("s1", { delayMs: 0 })).resolves.toBeUndefined();
	});

	it("gives up with SiteDeleteTimeoutError at the attempt cap", async () => {
		const fetch = vi.fn().mockImplementation(async () => deleting());
		vi.stubGlobal("fetch", fetch);

		await expect(deleteLegacySite("s1", { delayMs: 0, maxAttempts: 4 })).rejects.toBeInstanceOf(
			SiteDeleteTimeoutError,
		);
		expect(fetch).toHaveBeenCalledTimes(4);
	});

	it("surfaces other failures as LegacyApiError without retrying", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(reply(404, { success: false, error: "Site not found" }));
		vi.stubGlobal("fetch", fetch);

		const err = await deleteLegacySite("s1", { delayMs: 0 }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LegacyApiError);
		expect((err as LegacyApiError).message).toBe("Site not found");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("drops the session on 401", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(401)));
		await expect(deleteLegacySite("s1", { delayMs: 0 })).rejects.toMatchObject({ status: 401 });
		expect(localStorage.getItem("kp_token")).toBeNull();
	});
});

describe("growth plan lock", () => {
	it("maps 403 plan_required to GrowthPlanLockedError with the required plan", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					reply(403, { success: false, error: "plan_required", required_plan: "growth" }),
				),
		);
		const err = await fetchInsights("s1", "7d").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GrowthPlanLockedError);
		expect((err as GrowthPlanLockedError).requiredPlan).toBe("growth");
	});

	it("keeps any other 403 a normal LegacyApiError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(reply(403, { success: false, error: "Not a member of this team" })),
		);
		const err = await fetchInsights("s1", "7d").catch((e: unknown) => e);
		expect(err).not.toBeInstanceOf(GrowthPlanLockedError);
		expect(err).toBeInstanceOf(LegacyApiError);
		expect((err as LegacyApiError).message).toBe("Not a member of this team");
	});
});

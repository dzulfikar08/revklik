/**
 * Offline tests for the integration-review fixes: auth error mapping,
 * Google OAuth URL, tz param, email verification, SSE 401 handling,
 * funnel plan lock and currency-aware journey mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { funnelLockPlan, stepToEvent } from "@/components/analytics/analytics-page";

import { authErrorMessage } from "./auth-errors";
import { googleAuthUrl } from "./auth-search";
import {
	connectSSE,
	fetchDashboard,
	LEGACY_API_BASE,
	LegacyApiError,
	legacyLogin,
	legacyLogout,
	tzParam,
	verifyEmail,
} from "./legacy/api";

const t = (key: string) => `t:${key}`;

beforeEach(() => {
	localStorage.clear();
	legacyLogout();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("login throttling", () => {
	it("keeps too_many_attempts as a code and maps it to auth.throttled", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 429,
				json: async () => ({ success: false, error: "too_many_attempts" }),
			}),
		);
		const err = await legacyLogin("a@b.c", "pw123456").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LegacyApiError);
		expect((err as LegacyApiError).code).toBe("too_many_attempts");
		expect((err as LegacyApiError).message).not.toContain("too_many_attempts");
		expect(authErrorMessage(err, false, t)).toBe("t:auth.throttled");
	});

	it.each<[unknown, boolean, string]>([
		[new LegacyApiError("Invalid credentials", 401), false, "Invalid credentials"],
		[new LegacyApiError("email_taken", 400), true, "t:auth.signUpError"],
		[new LegacyApiError("Request failed (500)", 500), false, "t:auth.error"],
		[new Error("offline"), true, "t:auth.signUpError"],
	])("authErrorMessage(%s, signUp=%s) -> %s", (err, signUp, expected) => {
		expect(authErrorMessage(err, signUp, t)).toBe(expected);
	});
});

describe("googleAuthUrl", () => {
	it.each([
		[undefined, undefined, `${LEGACY_API_BASE}/auth/google`],
		["budi", undefined, `${LEGACY_API_BASE}/auth/google?ref=budi`],
		["budi", "growth", `${LEGACY_API_BASE}/auth/google?ref=budi&plan=growth`],
		["bad ref!", "gold", `${LEGACY_API_BASE}/auth/google`],
	])("ref=%j plan=%j", (ref, plan, expected) => {
		expect(googleAuthUrl(LEGACY_API_BASE, ref, plan)).toBe(expected);
	});
});

describe("tz param", () => {
	it("is east-positive minutes", () => {
		const jakarta = { getTimezoneOffset: () => -420 } as Date;
		const newYork = { getTimezoneOffset: () => 240 } as Date;
		expect(tzParam(jakarta)).toBe("420");
		expect(tzParam(newYork)).toBe("-240");
	});

	it("is sent with dashboard reads", async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ success: true, data: {} }),
		});
		vi.stubGlobal("fetch", fetch);
		await fetchDashboard("s1", "7d", "");
		const url = new URL(fetch.mock.calls[0]?.[0] as string);
		expect(url.searchParams.get("tz")).toBe(tzParam());
	});
});

describe("verifyEmail", () => {
	it.each<[number, unknown, string]>([
		[200, { success: true }, "verified"],
		[400, { success: false, error: "invalid_token" }, "invalid_token"],
		[400, { success: false, error: "expired" }, "expired"],
		[500, null, "error"],
	])("HTTP %d %j -> %s", async (status, body, expected) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }),
		);
		await expect(verifyEmail("tok")).resolves.toBe(expected);
	});
});

describe("connectSSE", () => {
	it("stops retrying after a 401", async () => {
		vi.useFakeTimers();
		localStorage.setItem("kp_token", "kp_dead");
		const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, body: null });
		vi.stubGlobal("fetch", fetch);
		const stop = connectSSE("s1", () => {});
		await vi.advanceTimersByTimeAsync(120_000);
		expect(fetch).toHaveBeenCalledTimes(1);
		stop();
	});
});

describe("funnelLockPlan", () => {
	it.each<[unknown, string | null]>([
		[new LegacyApiError("x", 403, { error: "plan_required", required_plan: "starter" }), "starter"],
		[new LegacyApiError("x", 403, { error: "plan_required", required_plan: "growth" }), "growth"],
		[new LegacyApiError("x", 403), "starter"],
		[new LegacyApiError("x", 500), null],
		[null, null],
	])("%s -> %s", (err, expected) => {
		expect(funnelLockPlan(err)).toBe(expected);
	});
});

describe("revenue currency in journeys", () => {
	it("formats conversion revenue in the response currency", () => {
		const step = {
			event_type: "conversion",
			name: "purchase",
			path: "/checkout",
			props: null,
			revenue: 64_000,
			timestamp: "2026-10-01T00:00:00Z",
		};
		const idr = stepToEvent(step, "IDR");
		expect(idr?.revenue?.replace(/\s/gu, " ")).toBe("Rp 64.000");
		expect(stepToEvent(step)?.revenue).toBe("$64,000");
	});
});

/** Offline tests for the global QueryCache toast policy. */
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks }));

import { setLocale } from "@/lib/i18n";
import { LegacyApiError } from "@/lib/legacy/api";
import { GrowthPlanLockedError } from "@/lib/legacy/growth";
import { registerSessionExpiredHandler } from "@/lib/session-nav";

import { createQueryClient, PLAN_TOAST_ID } from "./query-client";

setLocale("en");

const boom = () => Promise.reject(new Error("kaboom"));

beforeEach(() => {
	mocks.error.mockClear();
	mocks.success.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("QueryCache error toast policy", () => {
	it("toasts real failures with a retry action", async () => {
		const qc = createQueryClient();

		await expect(
			qc.fetchQuery({ queryFn: boom, queryKey: ["dash"], retry: false }),
		).rejects.toThrow("kaboom");

		expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
			"Error: kaboom",
			expect.objectContaining({
				action: expect.objectContaining({ label: "retry" }),
			}),
		);
	});

	it("does not toast queries that opt out via meta.silent", async () => {
		const qc = createQueryClient();

		await expect(
			qc.fetchQuery({
				meta: { silent: true },
				queryFn: boom,
				queryKey: ["gsc"],
				retry: false,
			}),
		).rejects.toThrow("kaboom");

		expect(mocks.error).not.toHaveBeenCalled();
	});

	it("silence is per-query, not global", async () => {
		const qc = createQueryClient();

		await expect(
			qc.fetchQuery({
				meta: { silent: true },
				queryFn: boom,
				queryKey: ["silent"],
				retry: false,
			}),
		).rejects.toThrow("kaboom");
		await expect(
			qc.fetchQuery({ queryFn: boom, queryKey: ["loud"], retry: false }),
		).rejects.toThrow("kaboom");

		expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Error: kaboom", expect.anything());
	});

	it("stays quiet on 402 subscription_inactive (the upgrade lock covers it)", async () => {
		const qc = createQueryClient();
		const lapsed = () =>
			Promise.reject(
				new LegacyApiError("Request failed (402)", 402, { error: "subscription_inactive" }),
			);

		await expect(
			qc.fetchQuery({ queryFn: lapsed, queryKey: ["dash"], retry: false }),
		).rejects.toThrow();

		expect(mocks.error).not.toHaveBeenCalled();
	});

	it("turns 403 plan_required into one upgrade toast", async () => {
		const qc = createQueryClient();
		const gated = () =>
			Promise.reject(
				new LegacyApiError("Request failed (403)", 403, {
					error: "plan_required",
					required_plan: "starter",
				}),
			);

		await expect(
			qc.fetchQuery({ queryFn: gated, queryKey: ["funnel"], retry: false }),
		).rejects.toThrow();
		await expect(new MutationObserver(qc, { mutationFn: gated }).mutate()).rejects.toThrow();

		expect(mocks.error).toHaveBeenCalledTimes(2);
		expect(mocks.error).toHaveBeenLastCalledWith(
			"This needs the Starter plan.",
			expect.objectContaining({
				action: expect.objectContaining({ label: "Upgrade" }),
				id: PLAN_TOAST_ID,
			}),
		);
	});

	it("sends a mid-session 401 to sign-in without a toast", async () => {
		const expired = vi.fn();
		registerSessionExpiredHandler(expired);
		const qc = createQueryClient();
		const dead = () => Promise.reject(new LegacyApiError("Session expired", 401));

		await expect(qc.fetchQuery({ queryFn: dead, queryKey: ["s"], retry: false })).rejects.toThrow();
		await expect(new MutationObserver(qc, { mutationFn: dead }).mutate()).rejects.toThrow();

		expect(expired).toHaveBeenCalledTimes(2);
		expect(mocks.error).not.toHaveBeenCalled();
	});

	it("does not toast Growth-locked panels (they render their own lock)", async () => {
		const qc = createQueryClient();
		const locked = () => Promise.reject(new GrowthPlanLockedError("growth"));

		await expect(
			qc.fetchQuery({ queryFn: locked, queryKey: ["heatmap"], retry: false }),
		).rejects.toThrow();

		expect(mocks.error).not.toHaveBeenCalled();
	});

	it("createQueryClient returns an isolated client", () => {
		const a = createQueryClient();
		const b = createQueryClient();
		expect(a).toBeInstanceOf(QueryClient);
		expect(a).not.toBe(b);
	});
});

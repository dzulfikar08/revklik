/** Offline tests for the global QueryCache toast policy. */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks }));

import { createQueryClient } from "./query-client";

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

	it("createQueryClient returns an isolated client", () => {
		const a = createQueryClient();
		const b = createQueryClient();
		expect(a).toBeInstanceOf(QueryClient);
		expect(a).not.toBe(b);
	});
});

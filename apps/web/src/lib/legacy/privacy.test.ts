/** Offline tests for account and visitor deletion client calls. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_API_BASE, LegacyApiError, legacyLogout } from "./api";
import { AccountDeleteTimeoutError, deleteAccount, deleteVisitorData } from "./privacy";

const reply = (status: number, body: unknown = null) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

beforeEach(() => {
	localStorage.clear();
	legacyLogout();
	localStorage.setItem("kp_token", "kp_live");
	localStorage.setItem(
		"kp_user",
		JSON.stringify({ email: "a@b.id", id: "u1", name: "A", role: "user" }),
	);
	localStorage.setItem("kp_tokens", JSON.stringify({ u1: "kp_live", u2: "kp_other" }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("deleteAccount", () => {
	it("re-sends the same request while the server answers 202 and signs out on 200", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(reply(202, { data: { status: "deleting" }, success: true }))
			.mockResolvedValueOnce(reply(200, { success: true }));
		vi.stubGlobal("fetch", fetch);

		await deleteAccount({ confirmEmail: "a@b.id", currentPassword: "pw" }, { delayMs: 0 });

		expect(fetch).toHaveBeenCalledTimes(2);
		const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${LEGACY_API_BASE}/auth/account`);
		expect(init.method).toBe("DELETE");
		expect(JSON.parse(init.body as string)).toEqual({
			confirm_email: "a@b.id",
			current_password: "pw",
		});
		expect((fetch.mock.calls[1] as [string, RequestInit])[1].body).toBe(init.body);
		expect(localStorage.getItem("kp_token")).toBeNull();
		expect(JSON.parse(localStorage.getItem("kp_tokens") ?? "{}")).toEqual({ u2: "kp_other" });
	});

	it("omits the password for Google-only accounts", async () => {
		const fetch = vi.fn().mockResolvedValue(reply(200, { success: true }));
		vi.stubGlobal("fetch", fetch);
		await deleteAccount({ confirmEmail: "a@b.id" }, { delayMs: 0 });
		expect(JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
			confirm_email: "a@b.id",
		});
	});

	it("keeps the session and the error code when the password is wrong", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(reply(403, { error: "current_password_invalid", success: false })),
		);
		const err = await deleteAccount({ confirmEmail: "a@b.id", currentPassword: "x" }).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(LegacyApiError);
		expect((err as LegacyApiError).code).toBe("current_password_invalid");
		expect(localStorage.getItem("kp_token")).toBe("kp_live");
	});

	it("times out instead of looping forever", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async () => reply(202, { success: true })),
		);
		await expect(
			deleteAccount({ confirmEmail: "a@b.id" }, { delayMs: 0, maxAttempts: 3 }),
		).rejects.toBeInstanceOf(AccountDeleteTimeoutError);
	});
});

describe("deleteVisitorData", () => {
	it("encodes both ids in the path", async () => {
		const fetch = vi.fn().mockResolvedValue(reply(200, { data: { events: 4 }, success: true }));
		vi.stubGlobal("fetch", fetch);
		await expect(deleteVisitorData("s 1", "v/2")).resolves.toMatchObject({ events: 4 });
		expect((fetch.mock.calls[0] as [string])[0]).toBe(
			`${LEGACY_API_BASE}/sites/s%201/visitors/v%2F2`,
		);
	});
});

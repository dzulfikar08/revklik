/**
 * Offline unit tests for the legacy API client: envelope unwrapping,
 * error mapping, native auth flows, token resolution order, and filter
 * encoding. All network access is mocked — no production calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	LEGACY_API_BASE,
	LegacyApiError,
	encodeFilterString,
	getToken,
	getLegacyUser,
	legacyFetch,
	legacyLogin,
	legacyLogout,
	legacyRegister,
	legacySignOut,
	type LegacyFilter,
} from "./api";

const okEnvelope = <T>(data: T) => ({
	ok: true,
	status: 200,
	json: async () => ({ success: true, data }),
});

const fetchMock = () => vi.fn<(input: string | URL) => Promise<unknown>>();

const TEST_USER = { id: "u1", name: "A", email: "a@b.c", role: "owner" };

beforeEach(() => {
	localStorage.clear();
	legacyLogout();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("legacyFetch envelope unwrapping", () => {
	it("returns the unwrapped data and sends the bearer token", async () => {
		localStorage.setItem("kp_token", "kp_stored");
		const fetch = fetchMock();
		fetch.mockResolvedValue(okEnvelope({ hello: "world" }));
		vi.stubGlobal("fetch", fetch);

		await expect(legacyFetch("/sites")).resolves.toEqual({ hello: "world" });

		expect(fetch).toHaveBeenCalledExactlyOnceWith(`${LEGACY_API_BASE}/sites`, {
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer kp_stored",
			},
		});
	});

	it("merges caller headers over the defaults", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue(okEnvelope(null));
		vi.stubGlobal("fetch", fetch);

		await legacyFetch("/x", {
			headers: { "Content-Type": "text/plain" },
			method: "POST",
		});
		// Mock calls are runtime-shaped; bridge through unknown for the tuple.
		const [, init] = fetch.mock.calls[0] as unknown as [
			string,
			{ headers: Record<string, string>; method: string },
		];
		expect(init.headers["Content-Type"]).toBe("text/plain");
		expect(init.method).toBe("POST");
	});

	it("maps a failure envelope to LegacyApiError with the API message", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ success: false, error: "Nope" }),
		});
		vi.stubGlobal("fetch", fetch);

		const err = await legacyFetch("/x").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LegacyApiError);
		expect((err as LegacyApiError).message).toBe("Nope");
		expect((err as LegacyApiError).status).toBe(200);
	});

	it("falls back to a generic message when the envelope has no error", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ success: false }),
		});
		vi.stubGlobal("fetch", fetch);

		await expect(legacyFetch("/x")).rejects.toMatchObject({
			name: "LegacyApiError",
			message: "Request failed",
		});
	});

	it("maps non-2xx responses to Request failed (status)", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue({ ok: false, status: 500 });
		vi.stubGlobal("fetch", fetch);

		const err = await legacyFetch("/x").catch((e: unknown) => e);
		expect((err as LegacyApiError).message).toBe("Request failed (500)");
		expect((err as LegacyApiError).status).toBe(500);
	});
});

describe("legacyFetch 401 recovery", () => {
	it("throws Session expired and drops the stored token", async () => {
		localStorage.setItem("kp_token", "kp_dead");
		const fetch = fetchMock();
		fetch.mockResolvedValue({ ok: false, status: 401 });
		vi.stubGlobal("fetch", fetch);

		await expect(legacyFetch("/x")).rejects.toMatchObject({
			message: "Session expired — sign in again",
			status: 401,
		});
		expect(localStorage.getItem("kp_token")).toBeNull();
	});

	it("sends no Authorization header when signed out", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue(okEnvelope([]));
		vi.stubGlobal("fetch", fetch);

		await expect(legacyFetch("/x")).resolves.toEqual([]);
		const [, init] = fetch.mock.calls[0] as unknown as [
			string,
			{ headers: Record<string, string> },
		];
		expect(init.headers.Authorization).toBeUndefined();
	});
});

describe("native auth flows", () => {
	it("legacyLogin persists the token + user and returns the user", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue(okEnvelope({ user: TEST_USER, token: "kp_session" }));
		vi.stubGlobal("fetch", fetch);

		await expect(legacyLogin("a@b.c", "pw123456")).resolves.toEqual(TEST_USER);

		const [url, init] = fetch.mock.calls[0] as unknown as [
			string,
			{ method: string; body: string; headers: Record<string, string> },
		];
		expect(url).toBe(`${LEGACY_API_BASE}/auth/login`);
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual({ email: "a@b.c", password: "pw123456" });
		expect(localStorage.getItem("kp_token")).toBe("kp_session");
		expect(getLegacyUser()).toEqual(TEST_USER);
		await expect(getToken()).resolves.toBe("kp_session");
	});

	it("legacyRegister posts name/email/password to /auth/register", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue(okEnvelope({ user: TEST_USER, token: "kp_new" }));
		vi.stubGlobal("fetch", fetch);

		await expect(legacyRegister("A", "a@b.c", "pw123456")).resolves.toEqual(TEST_USER);

		const [url, init] = fetch.mock.calls[0] as unknown as [
			string,
			{ method: string; body: string },
		];
		expect(url).toBe(`${LEGACY_API_BASE}/auth/register`);
		expect(JSON.parse(init.body)).toEqual({
			name: "A",
			email: "a@b.c",
			password: "pw123456",
		});
		expect(localStorage.getItem("kp_token")).toBe("kp_new");
	});

	it("surfaces the API error message on bad credentials", async () => {
		const fetch = fetchMock();
		fetch.mockResolvedValue({
			ok: false,
			status: 401,
			json: async () => ({ success: false, error: "Invalid credentials" }),
		});
		vi.stubGlobal("fetch", fetch);

		const err = await legacyLogin("a@b.c", "wrong").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LegacyApiError);
		expect((err as LegacyApiError).message).toBe("Invalid credentials");
		expect((err as LegacyApiError).status).toBe(401);
		// Nothing persisted on failure.
		expect(localStorage.getItem("kp_token")).toBeNull();
		expect(getLegacyUser()).toBeNull();
	});

	it("legacySignOut deletes the session server-side and clears local state", async () => {
		localStorage.setItem("kp_token", "kp_bye");
		localStorage.setItem("kp_user", JSON.stringify(TEST_USER));
		localStorage.setItem("kp_active_site", "s1");
		const fetch = fetchMock();
		fetch.mockResolvedValue(okEnvelope({ loggedOut: true }));
		vi.stubGlobal("fetch", fetch);

		await legacySignOut();

		const [url, init] = fetch.mock.calls[0] as unknown as [
			string,
			{ method: string; headers: Record<string, string> },
		];
		expect(url).toBe(`${LEGACY_API_BASE}/auth/logout`);
		expect(init.method).toBe("POST");
		expect(init.headers.Authorization).toBe("Bearer kp_bye");
		expect(localStorage.getItem("kp_token")).toBeNull();
		expect(getLegacyUser()).toBeNull();
		expect(localStorage.getItem("kp_active_site")).toBeNull();
	});

	it("legacySignOut clears locally even when the network fails", async () => {
		localStorage.setItem("kp_token", "kp_bye");
		const fetch = fetchMock();
		fetch.mockRejectedValue(new Error("offline"));
		vi.stubGlobal("fetch", fetch);

		await expect(legacySignOut()).resolves.toBeUndefined();
		expect(localStorage.getItem("kp_token")).toBeNull();
	});
});

describe("getToken resolution order", () => {
	it("returns the localStorage token", async () => {
		localStorage.setItem("kp_token", "kp_stored");
		await expect(getToken()).resolves.toBe("kp_stored");
	});

	it("serves the in-memory cache over a rotated localStorage value", async () => {
		localStorage.setItem("kp_token", "kp_first");
		await expect(getToken()).resolves.toBe("kp_first");
		localStorage.setItem("kp_token", "kp_rotated");
		await expect(getToken()).resolves.toBe("kp_first");
	});

	it("returns null when signed out", async () => {
		await expect(getToken()).resolves.toBeNull();
	});
});

describe("encodeFilterString", () => {
	it("joins dimension:operator:value triples with commas", () => {
		const rules: LegacyFilter[] = [
			{ dimension: "path", operator: "is", value: "/pricing" },
			{ dimension: "country", operator: "is_not", value: "US" },
		];
		expect(encodeFilterString(rules)).toBe("path:is:/pricing,country:is_not:US");
	});

	it("drops rules without a dimension", () => {
		const rules: LegacyFilter[] = [{ dimension: "", operator: "is", value: "x" }];
		expect(encodeFilterString(rules)).toBe("");
	});

	it("drops rules without a value unless the operator is existential", () => {
		const rules: LegacyFilter[] = [
			{ dimension: "path", operator: "is", value: "" },
			{ dimension: "utm_source", operator: "exists", value: "" },
			{ dimension: "utm_medium", operator: "not_exists", value: "" },
		];
		expect(encodeFilterString(rules)).toBe("utm_source:exists:,utm_medium:not_exists:");
	});
});

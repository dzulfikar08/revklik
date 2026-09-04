/**
 * Offline unit tests for the legacy API client: envelope unwrapping,
 * error mapping, token resolution order, and filter encoding.
 * All network and oRPC access is mocked — no production calls.
 */
import { ORPCError } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mintToken: vi.fn(),
}));

vi.mock("@/utils/orpc", () => ({
  client: { legacy: { mintToken: mocks.mintToken } },
}));

import {
  LEGACY_API_BASE,
  LegacyApiError,
  encodeFilterString,
  getToken,
  getLegacyUser,
  legacyFetch,
  legacyLogout,
  type LegacyFilter,
} from "./api";

const okEnvelope = <T,>(data: T) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

const fetchMock = () => vi.fn<(input: string | URL) => Promise<unknown>>();

const TEST_USER = { id: "u1", name: "A", email: "a@b.c", role: "owner" };

beforeEach(() => {
  localStorage.clear();
  legacyLogout();
  mocks.mintToken.mockReset();
  // Tests that never reach the mint path still need it to resolve sanely.
  mocks.mintToken.mockResolvedValue({ token: "kp_minted", user: TEST_USER });
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
    expect(mocks.mintToken).not.toHaveBeenCalled();
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

  it("re-mints on the next call after a 401", async () => {
    localStorage.setItem("kp_token", "kp_dead");
    mocks.mintToken.mockResolvedValue({
      token: "kp_fresh",
      user: { id: "u1", name: "A", email: "a@b.c", role: "owner" },
    });
    const fetch = fetchMock();
    fetch.mockImplementation(async () => ({ ok: false, status: 401 }));
    vi.stubGlobal("fetch", fetch);

    await legacyFetch("/x").catch(() => undefined);
    fetch.mockImplementation(async () => okEnvelope([]));

    await expect(legacyFetch("/x")).resolves.toEqual([]);
    expect(mocks.mintToken).toHaveBeenCalledExactlyOnceWith();
    const [url, init] = fetch.mock.calls[1] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(`${LEGACY_API_BASE}/x`);
    expect(init.headers.Authorization).toBe("Bearer kp_fresh");
  });
});

describe("getToken resolution order", () => {
  it("returns the localStorage token without minting", async () => {
    localStorage.setItem("kp_token", "kp_stored");

    await expect(getToken()).resolves.toBe("kp_stored");
    expect(mocks.mintToken).not.toHaveBeenCalled();
  });

  it("mints, persists token + user, and then serves from memory", async () => {
    const user = { id: "u1", name: "A", email: "a@b.c", role: "owner" };
    mocks.mintToken.mockResolvedValue({ token: "kp_minted", user });

    await expect(getToken()).resolves.toBe("kp_minted");
    expect(mocks.mintToken).toHaveBeenCalledExactlyOnceWith();
    expect(localStorage.getItem("kp_token")).toBe("kp_minted");
    expect(getLegacyUser()).toEqual(user);

    // A rotated localStorage value must lose to the in-memory cache.
    localStorage.setItem("kp_token", "kp_rotated");
    await expect(getToken()).resolves.toBe("kp_minted");
    expect(mocks.mintToken).toHaveBeenCalledExactlyOnceWith();
  });

  it("maps UNAUTHORIZED mint failures to LegacyApiError 401", async () => {
    mocks.mintToken.mockRejectedValue(
      new ORPCError("UNAUTHORIZED", { message: "not signed in" })
    );

    const err = await getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LegacyApiError);
    expect((err as LegacyApiError).status).toBe(401);
    expect((err as LegacyApiError).message).toBe("not signed in");
  });

  it("maps unknown mint failures to LegacyApiError 500", async () => {
    mocks.mintToken.mockRejectedValue(new ORPCError("INTERNAL_SERVER_ERROR"));

    const err = await getToken().catch((e: unknown) => e);
    expect((err as LegacyApiError).status).toBe(500);
  });

  it("keeps the upstream message when mint fails with a plain error", async () => {
    mocks.mintToken.mockRejectedValue(new Error("offline"));

    await expect(getToken()).rejects.toMatchObject({
      name: "LegacyApiError",
      message: "offline",
      status: 500,
    });
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

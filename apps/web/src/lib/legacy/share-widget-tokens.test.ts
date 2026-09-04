/** Offline tests for the public share/widget URL derivation. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/orpc", () => ({
  client: { legacy: { mintToken: vi.fn() } },
}));

import { API_ORIGIN, shareUrl, widgetScriptUrl } from "./share-widget-tokens";

describe("public URL derivation", () => {
  it("derives the worker origin by stripping the /api suffix", () => {
    expect(API_ORIGIN).toBe("https://app.revklik.com");
  });

  it("points the share feed at the API public route", () => {
    expect(shareUrl("tok_123")).toBe(
      "https://app.revklik.com/api/public/tok_123"
    );
  });

  it("serves the widget script from the origin root", () => {
    expect(widgetScriptUrl).toBe("https://app.revklik.com/klikapa-live.js");
  });
});

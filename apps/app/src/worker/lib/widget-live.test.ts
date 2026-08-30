import { describe, expect, it } from "bun:test";
import { clampTzOffset, dayStartIso, validateWidgetToken } from "./widget-live";

describe("validateWidgetToken", () => {
	it("accepts opaque UUID-style tokens", () => {
		expect(validateWidgetToken("3f2c9a1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f")).toBe(true);
	});

	it("accepts underscore and dash tokens", () => {
		expect(validateWidgetToken("abc_def-123")).toBe(true);
	});

	it("rejects tokens that are too short", () => {
		expect(validateWidgetToken("short")).toBe(false);
	});

	it("rejects tokens with special characters", () => {
		expect(validateWidgetToken("token with spaces!!")).toBe(false);
		expect(validateWidgetToken("token/inject../path")).toBe(false);
		expect(validateWidgetToken("")).toBe(false);
	});

	it("rejects tokens over 64 chars", () => {
		expect(validateWidgetToken("a".repeat(65))).toBe(false);
		expect(validateWidgetToken("a".repeat(64))).toBe(true);
	});
});

describe("clampTzOffset", () => {
	it("accepts east-positive and west-negative offsets", () => {
		expect(clampTzOffset(420)).toBe(420); // WIB
		expect(clampTzOffset(-300)).toBe(-300); // UTC-5
		expect(clampTzOffset(0)).toBe(0);
	});

	it("accepts the ±14h extremes", () => {
		expect(clampTzOffset(840)).toBe(840);
		expect(clampTzOffset(-840)).toBe(-840);
	});

	it("rejects out-of-range and non-integers", () => {
		expect(clampTzOffset(841)).toBeNull();
		expect(clampTzOffset(-841)).toBeNull();
		expect(clampTzOffset(7.5)).toBeNull();
		expect(clampTzOffset(Number.NaN)).toBeNull();
		expect(clampTzOffset(Number.POSITIVE_INFINITY)).toBeNull();
	});
});

describe("dayStartIso", () => {
	it("computes UTC midnight when offset is 0", () => {
		// 2026-08-27T10:30:00Z
		const now = Date.UTC(2026, 7, 27, 10, 30);
		expect(dayStartIso(now, 0)).toBe("2026-08-27T00:00:00.000Z");
	});

	it("computes WIB (UTC+7) local midnight", () => {
		// 2026-08-27T10:30:00Z = 17:30 WIB, so midnight WIB = 2026-08-26T17:00:00Z
		const now = Date.UTC(2026, 7, 27, 10, 30);
		expect(dayStartIso(now, 420)).toBe("2026-08-26T17:00:00.000Z");
	});

	it("computes UTC-5 local midnight", () => {
		// 2026-08-27T10:30:00Z = 05:30 UTC-5, midnight = 2026-08-27T05:00:00Z
		const now = Date.UTC(2026, 7, 27, 10, 30);
		expect(dayStartIso(now, -300)).toBe("2026-08-27T05:00:00.000Z");
	});

	it("rolls to the previous day shortly after local midnight", () => {
		// 2026-08-27T17:05:00Z = 00:05 WIB on the 28th → day start = 2026-08-27T17:00:00Z
		const now = Date.UTC(2026, 7, 27, 17, 5);
		expect(dayStartIso(now, 420)).toBe("2026-08-27T17:00:00.000Z");
	});
});

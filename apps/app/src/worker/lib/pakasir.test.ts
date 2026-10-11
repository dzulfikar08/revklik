import { describe, expect, it } from "bun:test";
import { newPakasirOrderId } from "./pakasir";

describe("newPakasirOrderId", () => {
	it("keeps two checkouts in the same millisecond apart", () => {
		const now = Date.now();
		const ids = new Set(Array.from({ length: 50 }, () => newPakasirOrderId("user-1234-abcd", now)));
		expect(ids.size).toBe(50);
	});

	it("stamps the user prefix and timestamp", () => {
		expect(newPakasirOrderId("user-1234-abcd", 1_000_000)).toMatch(
			/^RVK-user-123-LFLS[0-9A-Z]{4}$/,
		);
	});
});

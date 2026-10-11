import { describe, expect, it } from "vitest";

import { normalizeDomain } from "./domain";

describe("normalizeDomain", () => {
	it.each([
		["example.com", "example.com"],
		["  Example.COM  ", "example.com"],
		["https://shop.example.co.id/promo/", "shop.example.co.id"],
		["http://www.blog.id/", "www.blog.id"],
		["blog.id/?utm_source=x", "blog.id"],
		["example.com#top", "example.com"],
		["https://user:pw@example.com:8080/a", "example.com"],
		["example.com.", "example.com"],
		["localhost:3000", "localhost"],
	])("%s -> %s", (input, expected) => {
		expect(normalizeDomain(input)).toBe(expected);
	});

	it.each(["", "   ", "https://", "not a domain", "foo", "-bad-.com"])("rejects %j", (input) => {
		expect(normalizeDomain(input)).toBeNull();
	});
});

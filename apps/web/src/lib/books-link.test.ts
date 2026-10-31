import { describe, expect, it } from "vitest";

import { booksSignInUrl } from "./books-link";

describe("booksSignInUrl", () => {
	it("links the hosted product to production Books", () => {
		expect(booksSignInUrl({ override: undefined, selfHosted: false })).toBe(
			"https://books.revklik.com/auth/revklik/start",
		);
	});

	it("takes the base from VITE_BOOKS_URL, with or without a trailing slash", () => {
		expect(booksSignInUrl({ override: "http://localhost:8787", selfHosted: false })).toBe(
			"http://localhost:8787/auth/revklik/start",
		);
		expect(booksSignInUrl({ override: " https://books.example.com/ ", selfHosted: true })).toBe(
			"https://books.example.com/auth/revklik/start",
		);
	});

	it("shows nothing on a self-hosted install unless a Books URL is configured", () => {
		expect(booksSignInUrl({ override: undefined, selfHosted: true })).toBeNull();
		expect(booksSignInUrl({ override: "", selfHosted: true })).toBeNull();
	});
});

import { describe, expect, it } from "bun:test";
import { siteSnippet } from "./sites";

describe("siteSnippet", () => {
	it("emits the tracker's data-site-id contract", () => {
		const snippet = siteSnippet("https://app.revklik.com", "s-123");
		expect(snippet).toContain('data-site-id="s-123"');
		expect(snippet).toContain('src="https://app.revklik.com/klikapa.js"');
		expect(snippet).toContain("defer");
	});

	it("never emits the legacy globals the tracker ignores", () => {
		const snippet = siteSnippet("https://app.revklik.com", "s-123");
		expect(snippet).not.toContain("klikapa_site_id");
		expect(snippet).not.toContain("klikapa_endpoint");
	});
});

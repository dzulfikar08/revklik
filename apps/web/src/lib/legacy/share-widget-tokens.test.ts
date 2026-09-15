/** Offline tests for the public share/widget URL derivation. */
import { describe, expect, it } from "vitest";

import {
	API_ORIGIN,
	publicEmbedCode,
	publicEmbedUrl,
	publicPageUrl,
	shareUrl,
	widgetScriptUrl,
} from "./share-widget-tokens";

describe("public URL derivation", () => {
	it("derives the worker origin by stripping the /api suffix", () => {
		expect(API_ORIGIN).toBe("https://app.revklik.com");
	});

	it("points the share feed at the API public route", () => {
		expect(shareUrl("tok_123")).toBe("https://app.revklik.com/api/public/tok_123");
	});

	it("points the public dashboard page at the origin SPA route", () => {
		expect(publicPageUrl("tok_123")).toBe("https://app.revklik.com/public/tok_123");
	});

	it("flags the embed variant of the public page", () => {
		expect(publicEmbedUrl("tok_123")).toBe("https://app.revklik.com/public/tok_123?embed=1");
	});

	it("builds a ready-to-paste iframe embed snippet", () => {
		expect(publicEmbedCode("tok_123")).toBe(
			'<iframe src="https://app.revklik.com/public/tok_123?embed=1" style="width:100%;height:600px;border:0" loading="lazy"></iframe>',
		);
	});

	it("serves the widget script from the origin root", () => {
		expect(widgetScriptUrl).toBe("https://app.revklik.com/klikapa-live.js");
	});
});

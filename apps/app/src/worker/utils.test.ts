import { describe, expect, it } from "bun:test";
import { isBotUserAgent } from "./utils";

describe("isBotUserAgent", () => {
	it("flags search and AI crawlers", () => {
		expect(
			isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
		).toBe(true);
		expect(
			isBotUserAgent(
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
			),
		).toBe(true);
		expect(isBotUserAgent("ClaudeBot/1.0 (+claudebot@anthropic.com)")).toBe(true);
	});

	it("flags headless browsers and HTTP libraries", () => {
		expect(isBotUserAgent("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0")).toBe(true);
		expect(isBotUserAgent("python-requests/2.31.0")).toBe(true);
		expect(isBotUserAgent("curl/8.4.0")).toBe(true);
		expect(isBotUserAgent("Scrapy/2.11 (+https://scrapy.org)")).toBe(true);
	});

	it("flags uptime monitors", () => {
		expect(isBotUserAgent("UptimeRobot/2.0")).toBe(true);
	});

	it("keeps real browsers", () => {
		const macChrome =
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
		expect(isBotUserAgent(macChrome)).toBe(false);
		expect(
			isBotUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
			),
		).toBe(false);
	});

	it("treats missing or empty user agents as bots", () => {
		expect(isBotUserAgent(null)).toBe(true);
		expect(isBotUserAgent(undefined)).toBe(true);
		expect(isBotUserAgent("")).toBe(true);
	});
});

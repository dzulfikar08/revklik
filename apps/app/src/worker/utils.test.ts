import { describe, expect, it } from "bun:test";
import { classifyCrawler, isBotUserAgent } from "./utils";

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

	it("treats the bare WhatsApp link-preview UA as a bot but in-app browser clicks as human", () => {
		// Link-preview fetcher: bare "WhatsApp/x.y", no Mozilla token.
		expect(isBotUserAgent("WhatsApp/2.24.12.79")).toBe(true);
		expect(isBotUserAgent("WhatsApp/2.23.20.0 A")).toBe(true);
		// Human clicks from the WhatsApp in-app browser (iOS ships the token
		// inside a real browser UA; Android's token-less WebView was never flagged).
		expect(
			isBotUserAgent(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24.12.79",
			),
		).toBe(false);
		expect(
			isBotUserAgent(
				"Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36",
			),
		).toBe(false);
	});
	it("treats missing or empty user agents as bots", () => {
		expect(isBotUserAgent(null)).toBe(true);
		expect(isBotUserAgent(undefined)).toBe(true);
		expect(isBotUserAgent("")).toBe(true);
	});
});

describe("classifyCrawler", () => {
	it("names AI bots and their purpose", () => {
		expect(
			classifyCrawler(
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
			),
		).toEqual({ bot: "ChatGPT", category: "training" });
		expect(
			classifyCrawler("Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)"),
		).toEqual({ bot: "ChatGPT", category: "ai_answers" });
		expect(classifyCrawler("ClaudeBot/1.0 (+claudebot@anthropic.com)")).toEqual({
			bot: "Claude",
			category: "training",
		});
		expect(
			classifyCrawler(
				"Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
			),
		).toEqual({ bot: "Perplexity", category: "indexing" });
		expect(
			classifyCrawler("Mozilla/5.0 (compatible; DuckAssistBot/1.0; +https://duckduckgo.com)"),
		).toEqual({
			bot: "DuckDuckGo",
			category: "ai_answers",
		});
	});

	it("classifies the longer marker first (applebot-extended)", () => {
		expect(classifyCrawler("Mozilla/5.0 (compatible; Applebot-Extended/1.0)")).toEqual({
			bot: "Apple",
			category: "training",
		});
		expect(classifyCrawler("Mozilla/5.0 (compatible; Applebot/1.0)")).toEqual({
			bot: "Apple",
			category: "indexing",
		});
	});

	it("puts classic search bots in indexing", () => {
		expect(
			classifyCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
		).toEqual({ bot: "Google", category: "indexing" });
	});

	it("buckets non-AI bots as other", () => {
		expect(classifyCrawler("curl/8.4.0")).toEqual({ bot: "Other", category: "other" });
		expect(classifyCrawler("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0")).toEqual({
			bot: "Other",
			category: "other",
		});
		expect(classifyCrawler(null)).toEqual({ bot: "Unknown", category: "other" });
	});

	it("returns null for real browsers", () => {
		const chrome =
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
		expect(classifyCrawler(chrome)).toBeNull();
	});
});

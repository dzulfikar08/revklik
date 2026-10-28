import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { sql } from "kysely";
import { createDb } from "../db";
import { makeD1 } from "./test-harness";
import { classifySource, computedSourceSql, sourceSql } from "./source-sql";

/**
 * The invariant of per-row source classification: the JS rule stamped at ingest
 * and the SQL expression used by the backfill / read fallback give the same answer.
 */

const REFERRERS: Array<string | null> = [
	null,
	"",
	" ",
	"/",
	"a",
	"ab",
	"abc",
	"://x",
	"https:///path",
	"google.com",
	"www.google.com/search",
	"https://www.google.com/",
	"https://WWW.Google.co.id/search?q=x",
	"https://google.com.sg",
	"https://google.",
	"https://notgoogle.com/",
	"android-app://com.google.android.googlequicksearchbox/",
	"https://Bing.com/search",
	"https://cn.bing.com/",
	"https://www.bing.com",
	"https://duckduckgo.com/",
	"https://r.search.yahoo.com/x",
	"https://Yandex.RU/",
	"https://yandex.com.tr/",
	"https://yandex.",
	"https://m.facebook.com/x",
	"https://l.facebook.com/l.php?u=1",
	"https://t.co/abc",
	"https://x.com/status/1",
	"https://l.instagram.com/?u=https%3A%2F%2Fx",
	"https://www.instagram.com/p/abc/?ig_text_post_permalink=1",
	"https://example.com/?x=IG_TEXT_FEED_TIMELINE",
	"https://example.com/?x=ig-text-feed-timeline",
	"https://example.com/?x=igXtextYpostZpermalink",
	"https://example.com/?x=ig_text_post_permalin",
	"https://threads.net/@a",
	"https://www.linkedin.com/feed",
	"https://lnkd.in/x",
	"https://youtu.be/x",
	"https://wa.me/123",
	"https://web.whatsapp.com/",
	"HTTPS://WWW.EXAMPLE.COM/Path",
	"https://sub.www.example.com/",
	"https://wwwexample.com/",
	"https://example.com?x=1",
	"https://example.com#frag",
	"https://example.com:8080/x",
	"https://user@example.com/x",
	"https://ÄÖ.example/",
	"https://Ünï.EXAMPLE/",
	"😀😀x",
	"😀😀😀",
	"https://😀.example/",
	"\thttps://example.com/",
	"https://example.com\t/",
	"https:// example.com /",
	"  https://example.com/",
	"https://example.com/a://b",
	"ftp://example.com/",
	"example.com/path://x",
];

const UTM_SOURCES: Array<string | null> = [
	null,
	"",
	" ",
	"   ",
	"\t",
	"google",
	"Google",
	" GOOGLE ",
	"google.co.uk",
	"Bing",
	"msn",
	"DDG",
	"duck.com",
	"yahoo",
	"yandex",
	"yandex.kz",
	"fb",
	"FB",
	"x",
	"X",
	"ig",
	"newsletter",
	"Newsletter ",
	" my source ",
	"ÄÖ",
	"😀",
	"threads",
	"linkedin",
	"wa.me",
	"tiktok",
];

const BROWSERS: Array<string | null> = [
	null,
	"",
	"Chrome",
	"WhatsApp",
	"whatsapp",
	"WHATSAPP",
	"WhatsApp ",
];

function fixture() {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE events (id INTEGER PRIMARY KEY, referrer TEXT, utm_source TEXT, browser TEXT, source TEXT)",
	);
	return { db, kysely: createDb(makeD1(db) as never) };
}

function cases() {
	const out: Array<{ referrer: string | null; utm_source: string | null; browser: string | null }> =
		[];
	for (const referrer of REFERRERS) {
		// Every referrer against every browser with no utm, then against a rotating utm.
		for (const browser of BROWSERS) out.push({ referrer, utm_source: null, browser });
		for (const [i, utm_source] of UTM_SOURCES.entries()) {
			out.push({ referrer, utm_source, browser: BROWSERS[i % BROWSERS.length] ?? null });
		}
	}
	for (const utm_source of UTM_SOURCES) {
		for (const browser of BROWSERS) out.push({ referrer: null, utm_source, browser });
	}
	return out;
}

describe("classifySource equals the SQL expression", () => {
	it("agrees on every referrer / utm_source / browser combination", async () => {
		const { db, kysely } = fixture();
		const insert = db.prepare("INSERT INTO events (referrer, utm_source, browser) VALUES (?,?,?)");
		const all = cases();
		for (const c of all) insert.run(c.referrer, c.utm_source, c.browser);

		const { rows } = await sql<{ id: number; s: string }>`
			SELECT id, ${computedSourceSql} AS s FROM events ORDER BY id`.execute(kysely);
		expect(rows.length).toBe(all.length);

		const mismatches = rows.flatMap((row, i) => {
			const input = all[i];
			if (!input) return [];
			const js = classifySource(input);
			return js === row.s ? [] : [{ input, sql: row.s, js }];
		});
		expect(mismatches).toEqual([]);
	});

	it("maps the known aliases and families", () => {
		expect(classifySource({ utm_source: "Bing" })).toBe("bing.com");
		expect(classifySource({ referrer: "https://www.bing.com/search" })).toBe("bing.com");
		expect(classifySource({ referrer: "https://www.google.co.id/" })).toBe("google.com");
		expect(classifySource({ referrer: "https://yandex.ru/" })).toBe("yandex.com");
		expect(classifySource({ referrer: "https://m.facebook.com/x" })).toBe("facebook");
		expect(classifySource({ referrer: "https://t.co/abc" })).toBe("twitter");
		expect(classifySource({})).toBe("direct");
		expect(classifySource({ browser: "WhatsApp" })).toBe("whatsapp");
		expect(classifySource({ browser: "WhatsApp", utm_source: "newsletter" })).toBe("newsletter");
		expect(classifySource({ referrer: "https://x.com/?ig_text_post_permalink=1" })).toBe(
			"instagram",
		);
	});
});

describe("sourceSql", () => {
	it("prefers the stamped source and computes it for unstamped rows", async () => {
		const { db, kysely } = fixture();
		db.prepare("INSERT INTO events (referrer, utm_source, source) VALUES (?,?,?)").run(
			"https://www.bing.com/",
			null,
			"stamped",
		);
		db.prepare("INSERT INTO events (referrer, utm_source) VALUES (?,?)").run(
			"https://www.bing.com/",
			null,
		);
		const { rows } = await sql<{ s: string }>`
			SELECT ${sourceSql} AS s FROM events ORDER BY id`.execute(kysely);
		expect(rows.map((r) => r.s)).toEqual(["stamped", "bing.com"]);
	});
});

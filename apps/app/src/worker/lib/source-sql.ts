import { type RawBuilder, sql } from "kysely";

/**
 * Traffic-source normalization, shared by the dashboard and the public API so
 * `bing`, `bing.com` and `www.bing.com` count as one source.
 *
 * Search engines and other sites use their hostname as the canonical name
 * (`bing.com`, `duckduckgo.com`); a short utm_source such as `bing` maps onto it.
 * Social networks keep the short names the dashboard has always used
 * (`facebook`, `twitter`, `instagram`, `threads`, `linkedin`, `youtube`).
 *
 * The rule exists twice and MUST stay identical: `classifySource` (JS, run at
 * ingest to stamp `events.source` / `sessions.source`) and `computedSourceSql`
 * (SQL, used by the v17 backfill and as the read fallback for unstamped rows).
 * source-sql.test.ts asserts they agree. Mirror SQLite semantics, not JS ones:
 * TRIM strips spaces only, LOWER is ASCII-only, `INSTR` of a missing `://` is 0
 * (so a scheme-less referrer loses its first two characters), and LIKE's `_`
 * matches any single character.
 */

/** Canonical name -> every hostname or short utm_source that means it. */
const SOURCE_ALIASES: Record<string, readonly string[]> = {
	"google.com": ["google", "com.google.android.googlequicksearchbox", "googlequicksearchbox"],
	"bing.com": ["bing", "cn.bing.com", "msn.com", "msn"],
	"duckduckgo.com": ["duckduckgo", "ddg", "duck.com"],
	"yahoo.com": ["yahoo", "search.yahoo.com", "r.search.yahoo.com", "yahoo.co.jp"],
	"yandex.com": ["yandex", "yandex.ru", "ya.ru"],
	"baidu.com": ["baidu", "m.baidu.com"],
	"ecosia.org": ["ecosia"],
	facebook: ["facebook.com", "m.facebook.com", "l.facebook.com", "lm.facebook.com", "fb", "fb.me"],
	twitter: ["twitter.com", "mobile.twitter.com", "t.co", "x.com", "x"],
	instagram: ["instagram.com", "l.instagram.com", "ig"],
	threads: ["threads.net", "threads.com", "l.threads.com"],
	linkedin: ["linkedin.com", "lnkd.in", "www.linkedin.com"],
	youtube: ["youtube.com", "m.youtube.com", "youtu.be"],
	whatsapp: ["wa.me", "api.whatsapp.com", "web.whatsapp.com"],
};

/** Hostname families written with many country suffixes (google.co.id, google.com.sg, ...). */
const SOURCE_FAMILY_PREFIXES: ReadonlyArray<readonly [canonical: string, prefix: string]> = [
	["google.com", "google."],
	["yandex.com", "yandex."],
];

/** Alias -> canonical; the first listing wins, like the SQL CASE. */
const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
	const map = new Map<string, string>();
	for (const [canonical, aliases] of Object.entries(SOURCE_ALIASES)) {
		for (const alias of aliases) if (!map.has(alias)) map.set(alias, canonical);
	}
	return map;
})();

/** SQLite `LOWER`: folds A-Z only. */
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** SQLite `TRIM(x)`: strips spaces (U+0020) only, not tabs or newlines. */
const trimSpaces = (s: string): string => s.replace(/^ +| +$/g, "");

/** Alias lookup on an already trimmed and lowercased name. */
function aliasOf(name: string): string {
	const direct = ALIAS_TO_CANONICAL.get(name);
	if (direct !== undefined) return direct;
	for (const [canonical, prefix] of SOURCE_FAMILY_PREFIXES) {
		if (name.startsWith(prefix)) return canonical;
	}
	return name;
}

const INSTAGRAM_REFERRER_RE = /ig[\s\S]text[\s\S](?:post[\s\S]permalink|feed[\s\S]timeline)/u;

/** JS twin of `referrerHost`; `referrer` is non-empty. */
function hostOfReferrer(referrer: string): string {
	const scheme = referrer.indexOf("://");
	const rest = scheme >= 0 ? referrer.slice(scheme + 3) : Array.from(referrer).slice(2).join("");
	const slash = rest.indexOf("/");
	const host = slash >= 0 ? rest.slice(0, slash) : rest;
	return asciiLower(host.replaceAll("www.", ""));
}

export interface SourceInput {
	referrer?: string | null;
	utm_source?: string | null;
	browser?: string | null;
}

/**
 * Per-row traffic source: utm_source, else the referrer's host, else `direct`
 * (or `whatsapp` for referrer-less WhatsApp in-app browsers), aliased to its
 * canonical name. JS twin of `computedSourceSql`.
 */
export function classifySource({ referrer, utm_source, browser }: SourceInput): string {
	const utm = utm_source == null ? "" : trimSpaces(utm_source);
	let raw: string;
	if (utm !== "") raw = utm;
	else if (referrer == null || referrer === "") {
		raw = browser != null && asciiLower(browser) === "whatsapp" ? "whatsapp" : "direct";
	} else if (INSTAGRAM_REFERRER_RE.test(asciiLower(referrer))) raw = "instagram";
	else raw = hostOfReferrer(referrer);
	return aliasOf(asciiLower(trimSpaces(raw)));
}

/** Hostname of `referrer` without scheme, path or a leading `www.`; NULL when it has none. */
const referrerHost = sql<string>`LOWER(REPLACE(
        SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
          INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
        'www.', ''))`;

/**
 * Condition keeping only rows that arrived from outside the site: a pageview whose
 * referrer is the site itself (or one of its subdomains) is navigation, not a
 * traffic source, and the visitor's entry pageview already carries the real one.
 * A utm_source always counts as external.
 */
export function externalReferrerOnly(siteDomain: string): RawBuilder<boolean> {
	const domain = siteDomain
		.trim()
		.toLowerCase()
		.replace(/^www\./, "");
	return sql<boolean>`NOT (COALESCE(utm_source, '') = '' AND referrer IS NOT NULL AND referrer != ''
    AND (${referrerHost} = ${domain} OR ${referrerHost} LIKE ${`%.${domain}`}))`;
}

/** Source before aliasing: utm_source, else what the referrer says, else 'direct'. */
const rawSource = sql<string>`LOWER(TRIM(COALESCE(NULLIF(TRIM(utm_source), ''),
  CASE WHEN (referrer IS NULL OR referrer = '') AND LOWER(browser) = 'whatsapp' THEN 'whatsapp'
  WHEN referrer IS NULL OR referrer = '' THEN 'direct'
  WHEN referrer LIKE '%ig_text_post_permalink%' OR referrer LIKE '%ig_text_feed_timeline%' THEN 'instagram'
  ELSE ${referrerHost}
  END)))`;

/** `CASE <operand> WHEN <alias> THEN <canonical> ... ELSE <operand> END`, aliases bound as literals. */
function aliasCase(operand: RawBuilder<string>): RawBuilder<string> {
	const arms = Object.entries(SOURCE_ALIASES).flatMap(([canonical, aliases]) =>
		aliases.map((alias) => sql`WHEN ${sql.lit(alias)} THEN ${sql.lit(canonical)}`),
	);
	const family = SOURCE_FAMILY_PREFIXES.map(
		([canonical, prefix]) =>
			sql`WHEN ${operand} LIKE ${sql.lit(`${prefix}%`)} THEN ${sql.lit(canonical)}`,
	);
	return sql<string>`CASE ${operand} ${sql.join(arms, sql` `)}
    ELSE CASE ${sql.join(family, sql` `)} ELSE ${operand} END END`;
}

/** Canonical form of one utm_source column or expression (campaign tables). */
export function canonicalSource(operand: RawBuilder<string>): RawBuilder<string> {
	return aliasCase(sql<string>`LOWER(TRIM(${operand}))`);
}

/**
 * The classification computed from a row's `utm_source`, `referrer` and
 * `browser` columns (unqualified: works inside `UPDATE events` / `UPDATE sessions`).
 * The v17 backfill and the read fallback; new rows carry it pre-computed in `source`.
 */
export const computedSourceSql: RawBuilder<string> = aliasCase(rawSource);

/**
 * Per-event source of the `events` table: the stamped `events.source`, falling
 * back to the computed value for a row that was never stamped.
 */
export const sourceSql: RawBuilder<string> = sql<string>`COALESCE(${sql.ref("events.source")}, ${computedSourceSql})`;

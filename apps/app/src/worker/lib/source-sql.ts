import { type RawBuilder, sql } from "kysely";

/**
 * Traffic-source normalization, shared by the dashboard and the public API so
 * `bing`, `bing.com` and `www.bing.com` count as one source.
 *
 * Search engines and other sites use their hostname as the canonical name
 * (`bing.com`, `duckduckgo.com`); a short utm_source such as `bing` maps onto it.
 * Social networks keep the short names the dashboard has always used
 * (`facebook`, `twitter`, `instagram`, `threads`, `linkedin`, `youtube`).
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
const SOURCE_FAMILY_PATTERNS: ReadonlyArray<readonly [canonical: string, like: string]> = [
	["google.com", "google.%"],
	["yandex.com", "yandex.%"],
];

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
	const family = SOURCE_FAMILY_PATTERNS.map(
		([canonical, like]) => sql`WHEN ${operand} LIKE ${sql.lit(like)} THEN ${sql.lit(canonical)}`,
	);
	return sql<string>`CASE ${operand} ${sql.join(arms, sql` `)}
    ELSE CASE ${sql.join(family, sql` `)} ELSE ${operand} END END`;
}

/** Canonical form of one utm_source column or expression (campaign tables). */
export function canonicalSource(operand: RawBuilder<string>): RawBuilder<string> {
	return aliasCase(sql<string>`LOWER(TRIM(${operand}))`);
}

/**
 * Per-event source: utm_source, else the referrer's host, else `direct`,
 * aliased to its canonical name. Reads `utm_source`, `referrer` and `browser`
 * of the table being queried.
 */
export const sourceSql: RawBuilder<string> = aliasCase(rawSource);

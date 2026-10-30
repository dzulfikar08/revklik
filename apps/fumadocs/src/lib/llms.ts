import type { CollectionEntry } from "astro:content";

import { DEFAULT_LOCALE, type Locale } from "./i18n";
import { alternatesFor, isTranslated, orderedDocsPages, pageUrl } from "./source";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" } as const;

const INTRO: Record<Locale, { title: string; summary: string; otherLanguage: string }> = {
	en: {
		title: "# RevKlik docs",
		summary:
			"> Documentation for RevKlik: privacy-first web and revenue analytics, by revklik.com.",
		otherLanguage: "Bahasa Indonesia",
	},
	id: {
		title: "# Dokumentasi RevKlik",
		summary:
			"> Dokumentasi RevKlik: analitik web dan pendapatan yang menjaga privasi, dari revklik.com. Halaman yang belum diterjemahkan ada di versi bahasa Inggris.",
		otherLanguage: "English",
	},
};

const llmsPath = (locale: Locale, file: string) =>
	locale === DEFAULT_LOCALE ? `/${file}` : `/${locale}/${file}`;

/** URL a crawler should use: the page in `locale` when translated, otherwise its English original. */
function crawlerUrl(page: Parameters<typeof alternatesFor>[0]): string {
	return isTranslated(page)
		? pageUrl(page)
		: (alternatesFor(page).find((alternate) => alternate.locale === DEFAULT_LOCALE)?.url ??
				pageUrl(page));
}

function otherLocale(locale: Locale): Locale {
	return locale === DEFAULT_LOCALE ? "id" : DEFAULT_LOCALE;
}

export function llmsIndex(locale: Locale, base: URL): Response {
	const intro = INTRO[locale];
	const other = otherLocale(locale);
	const lines = [
		intro.title,
		"",
		intro.summary,
		"",
		`- [${INTRO[other].otherLanguage}](${new URL(llmsPath(other, "llms.txt"), base).href})`,
		"",
		...orderedDocsPages(locale).map(
			(page) =>
				`- [${page.data.title}](${new URL(crawlerUrl(page), base).href}): ${page.data.description ?? ""}`,
		),
		"",
	];

	return new Response(lines.join("\n"), { headers: TEXT_HEADERS });
}

export function llmsFull(locale: Locale): Response {
	const intro = INTRO[locale];
	const sections = orderedDocsPages(locale)
		.filter(isTranslated)
		.map((page) => {
			const body = (page.data._raw as CollectionEntry<"docs">).body ?? "";

			// Drop MDX plumbing so the output is plain markdown for AI crawlers.
			const markdown = body
				.split("\n")
				.filter((line) => !line.startsWith("import "))
				.join("\n")
				.trim();

			return [`# ${page.data.title}`, page.data.description ?? "", "", markdown, "", "---", ""].join(
				"\n",
			);
		});

	return new Response([intro.title, "", intro.summary, "", ...sections].join("\n"), {
		headers: TEXT_HEADERS,
	});
}

import * as path from "node:path";

import { type CollectionEntry, getCollection } from "astro:content";
import { structure, type StructuredData } from "fumadocs-core/mdx-plugins";
import type { Node } from "fumadocs-core/page-tree";
import type { StaticSource } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";

import { DEFAULT_LOCALE, i18n, LANGUAGES, localePrefix, withTrailingSlash, type Locale } from "./i18n";

export const source = loader({
	source: await createMySource(),
	baseUrl: "/",
	i18n,
	pageTree: {
		// The static build serves every page at `/<slug>/`; point sidebar links there so they never hop a redirect.
		transformers: [
			{
				file(node) {
					node.url = withTrailingSlash(node.url);

					return node;
				},
				folder(node) {
					if (node.index) node.index = { ...node.index, url: withTrailingSlash(node.index.url) };

					return node;
				},
			},
		],
	},
});

export type DocsPage = (typeof source)["$inferPage"];

export function getStructuredData(entry: CollectionEntry<"docs">): StructuredData {
	return structure(entry.body);
}

/** Canonical served URL of a page, trailing slash included. */
export function pageUrl(page: DocsPage): string {
	return withTrailingSlash(page.url);
}

/**
 * True when the page has content written in its own locale (`name.id.mdx`).
 * English pages without a twin are served under `/id/` through the loader's
 * fallback and keep their English body.
 */
export function isTranslated(page: DocsPage): boolean {
	if (page.locale === DEFAULT_LOCALE) return true;

	return new RegExp(`\\.${page.locale}\\.mdx?$`).test(page.path);
}

/** Language the body of the page is written in. */
export function contentLocale(page: DocsPage): Locale {
	return isTranslated(page) ? (page.locale as Locale) : DEFAULT_LOCALE;
}

export interface Alternate {
	locale: Locale;
	url: string;
	/** False when the page under this locale is the English fallback. */
	translated: boolean;
}

/** The same page in every language, for the language switch and hreflang links. */
export function alternatesFor(page: DocsPage): Alternate[] {
	const out: Alternate[] = [];

	for (const locale of LANGUAGES) {
		const alt = source.getPage(page.slugs, locale);

		if (alt) out.push({ locale, url: pageUrl(alt), translated: isTranslated(alt) });
	}

	return out;
}

/** OG image of a page. Untranslated fallback pages reuse the English card. */
export function getPageImageUrl(page: DocsPage): string {
	const segments = [...page.slugs, "image.png"];

	return `${localePrefix(contentLocale(page))}/${["og", "docs", ...segments].join("/")}`;
}

async function createMySource() {
	const out: StaticSource<{
		metaData: CollectionEntry<"meta">["data"];
		pageData: CollectionEntry<"docs">["data"] & {
			_raw: CollectionEntry<"docs">;
		};
	}> = {
		files: [],
	};

	for (const page of await getCollection("docs")) {
		const virtualPath = path.relative("content/docs", page.filePath!);

		out.files.push({
			type: "page",
			path: virtualPath,
			data: {
				...page.data,
				_raw: page,
			},
		});
	}

	for (const meta of await getCollection("meta")) {
		const virtualPath = path.relative("content/docs", meta.filePath!);

		out.files.push({
			type: "meta",
			path: virtualPath,
			data: meta.data,
		});
	}

	return out;
}

export interface DocRef {
	title: string;
	description: string;
	url: string;
}

const HOME: Record<Locale, DocRef> = {
	en: { title: "Home", description: "", url: "/" },
	id: { title: "Beranda", description: "", url: "/id/" },
};

/** Slugs for a served URL, with the locale prefix removed. */
function slugsFromUrl(url: string, locale: Locale): string[] {
	const segments = url.split("/").filter(Boolean);
	const prefix = localePrefix(locale).replace("/", "");

	return prefix && segments[0] === prefix ? segments.slice(1) : segments;
}

function pageRef(url: string, fallbackTitle: string, locale: Locale): DocRef {
	const page = source.getPage(slugsFromUrl(url, locale), locale);

	return {
		title: page?.data.title ?? fallbackTitle,
		description: page?.data.description ?? "",
		url,
	};
}

function firstPageUrl(nodes: Node[]): string | undefined {
	for (const node of nodes) {
		if (node.type === "page") return node.url;
		if (node.type === "folder") {
			const url = firstPageUrl(node.children);
			if (url) return url;
		}
	}

	return undefined;
}

function collect(nodes: Node[], out: DocsPage[], locale: Locale): void {
	for (const node of nodes) {
		if (node.type === "page") {
			const page = source.getPage(slugsFromUrl(node.url, locale), locale);

			if (page) out.push(page);
		} else if (node.type === "folder") collect(node.children, out, locale);
	}
}

/** Every doc page of a locale in sidebar order (folders recurse in place). */
export function orderedDocsPages(locale: Locale = DEFAULT_LOCALE): DocsPage[] {
	const out: DocsPage[] = [];

	collect(source.getPageTree(locale).children, out, locale);

	return out;
}

function resolveTrail(
	nodes: Node[],
	trail: DocRef[],
	url: string,
	locale: Locale,
): DocRef[] | null {
	for (const node of nodes) {
		if (node.type === "page") {
			if (node.url === url) return [...trail, pageRef(url, String(node.name), locale)];
		} else if (node.type === "folder") {
			// A folder has no page of its own; point its crumb at its first child.
			const crumb: DocRef = {
				title: String(node.name),
				description: "",
				url: firstPageUrl(node.children) ?? url,
			};
			const found = resolveTrail(node.children, [...trail, crumb], url, locale);

			if (found) return found;
		}
	}

	return null;
}

/** Trail from Home to the page at `url` (trailing slash), following folder names from meta files. */
export function breadcrumbs(url: string, locale: Locale = DEFAULT_LOCALE): DocRef[] {
	const home = HOME[locale];

	if (url === home.url) return [home];

	return (
		resolveTrail(source.getPageTree(locale).children, [home], url, locale) ?? [
			home,
			pageRef(url, url, locale),
		]
	);
}

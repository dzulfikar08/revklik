import { readdirSync } from "node:fs";

import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import {
	rehypeCode,
	remarkCodeTab,
	remarkHeading,
	remarkNpm,
	remarkStructure,
} from "fumadocs-core/mdx-plugins";

const SITE = "https://docs.revklik.com";
const DOCS_DIR = "./content/docs";
const ID_PAGE_SUFFIX = /\.id\.mdx?$/;

const remarkPlugins = [
	remarkHeading,
	remarkCodeTab,
	remarkNpm,
	[remarkStructure, { exportAs: "structuredData" }],
];
const rehypePlugins = [rehypeCode];

/**
 * Indonesian URLs that have their own translated body (`name.id.mdx`). Untranslated
 * pages are still served under /id/ (with an English body and a canonical pointing at
 * the English page), so they must stay out of the sitemap and out of hreflang pairs.
 */
function translatedIndonesianUrls() {
	const urls = new Set([`${SITE}/id/`]);

	for (const file of readdirSync(DOCS_DIR, { recursive: true })) {
		const name = String(file).replaceAll("\\", "/");

		if (!ID_PAGE_SUFFIX.test(name)) continue;

		const slug = name.replace(ID_PAGE_SUFFIX, "");

		if (slug === "index") continue;

		urls.add(`${SITE}/id/${slug}/`);
	}

	return urls;
}

const translatedIdUrls = translatedIndonesianUrls();
const indonesianPrefix = `${SITE}/id/`;

export default defineConfig({
	site: SITE,
	// Cloudflare Pages serves `/page/index.html` at `/page/`; make that the one URL shape.
	trailingSlash: "always",
	build: { format: "directory" },
	markdown: {
		processor: unified({
			syntaxHighlight: false,
			remarkPlugins,
			rehypePlugins,
		}),
	},
	integrations: [
		react(),
		mdx({
			extendMarkdownConfig: true,
			syntaxHighlight: false,
		}),
		sitemap({
			filter: (page) => {
				if (page === `${SITE}/404/` || page.endsWith("/404.html")) return false;
				if (!page.startsWith(indonesianPrefix)) return true;

				return translatedIdUrls.has(page);
			},
			i18n: { defaultLocale: "en", locales: { en: "en", id: "id" } },
			serialize: (item) => {
				const english = item.links?.find((link) => link.lang === "en");

				if (item.links && english) {
					item.links = [...item.links, { url: english.url, lang: "x-default" }];
				}

				return item;
			},
		}),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});

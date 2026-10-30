import type { APIRoute } from "astro";
import { createFromSource } from "fumadocs-core/search/server";

import { getStructuredData, pageUrl, source } from "@/lib/source";

// One index for every language; each entry carries its locale and the client filters on it.
const server = createFromSource(source, {
	buildIndex(page) {
		return {
			// The English body is indexed again for untranslated pages under /id/, so ids must include the locale.
			id: `${page.locale}:${page.data._raw.id}`,
			title: page.data.title,
			description: page.data.description,
			structuredData: getStructuredData(page.data._raw),
			url: pageUrl(page),
		};
	},
});

export const GET: APIRoute = () => {
	return server.staticGET();
};

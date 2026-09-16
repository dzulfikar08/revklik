import type { APIRoute } from "astro";
import type { CollectionEntry } from "astro:content";

import { orderedPages, source } from "@/lib/source";

export const GET: APIRoute = () => {
	const sections = orderedPages().map((ref) => {
		const page = source.getPage(ref.url.replace(/^\//, "").split("/").filter(Boolean));
		const body = (page?.data._raw as CollectionEntry<"docs"> | undefined)?.body ?? "";

		// Drop MDX plumbing so the output is plain markdown for AI crawlers.
		const markdown = body
			.split("\n")
			.filter((line) => !line.startsWith("import "))
			.join("\n")
			.trim();

		return [`# ${ref.title}`, ref.description, "", markdown, "", "---", ""].join("\n");
	});
	const lines = [
		"# RevKlik docs",
		"",
		"> Documentation for RevKlik: privacy-first web and revenue analytics by revklik.",
		"",
		...sections,
	];

	return new Response(lines.join("\n"), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};

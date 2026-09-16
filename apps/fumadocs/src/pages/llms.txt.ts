import type { APIRoute } from "astro";

import { orderedPages } from "@/lib/source";

export const GET: APIRoute = ({ site }) => {
	const base = site ?? new URL("https://docs.revklik.com");
	const lines = [
		"# RevKlik docs",
		"",
		"> Documentation for RevKlik: privacy-first web and revenue analytics by revklik.",
		"",
		...orderedPages().map(
			(page) => `- [${page.title}](${new URL(page.url, base).href}): ${page.description}`,
		),
		"",
	];

	return new Response(lines.join("\n"), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};

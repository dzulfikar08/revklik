import * as path from "node:path";

import { type CollectionEntry, getCollection } from "astro:content";
import { structure, type StructuredData } from "fumadocs-core/mdx-plugins";
import type { Node } from "fumadocs-core/page-tree";
import type { StaticSource } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";

export const source = loader({
	source: await createMySource(),
	baseUrl: "/",
});

export function getStructuredData(entry: CollectionEntry<"docs">): StructuredData {
	return structure(entry.body);
}

export function getPageImageUrl(page: (typeof source)["$inferPage"]) {
	const segments = [...page.slugs, "image.png"];

	return "/" + [page.locale, "og", "docs", ...segments].filter(Boolean).join("/");
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

const HOME: DocRef = { title: "Home", description: "", url: "/" };

function pageRef(url: string, fallbackTitle: string): DocRef {
	const page = source.getPage(url.replace(/^\//, "").split("/").filter(Boolean));

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

function collect(nodes: Node[], out: DocRef[]): void {
	for (const node of nodes) {
		if (node.type === "page") out.push(pageRef(node.url, String(node.name)));
		else if (node.type === "folder") collect(node.children, out);
	}
}

/** Every doc page in sidebar order (folders recurse in place). */
export function orderedPages(): DocRef[] {
	const out: DocRef[] = [];

	collect(source.getPageTree().children, out);

	return out;
}

function resolveTrail(nodes: Node[], trail: DocRef[], url: string): DocRef[] | null {
	for (const node of nodes) {
		if (node.type === "page") {
			if (node.url === url) return [...trail, pageRef(url, String(node.name))];
		} else if (node.type === "folder") {
			// A folder has no page of its own; point its crumb at its first child.
			const crumb: DocRef = {
				title: String(node.name),
				description: "",
				url: firstPageUrl(node.children) ?? url,
			};
			const found = resolveTrail(node.children, [...trail, crumb], url);

			if (found) return found;
		}
	}

	return null;
}

/** Trail from Home to the page at `url`, following folder names from meta files. */
export function breadcrumbs(url: string): DocRef[] {
	return resolveTrail(source.getPageTree().children, [HOME], url) ?? [HOME, pageRef(url, url)];
}

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { pageUrl } from '../data/seo';
import { getPosts, postPath, slugOf } from '../lib/blog';

type Entry = { id: string; en: string; lastmod?: string; priority: string };

// One <url> per locale page, each carrying the full id/en/x-default cluster, with
// the same canonical paths the pages declare (see src/data/seo.ts).
export const GET: APIRoute = async () => {
	const entries: Entry[] = [
		{ id: '/', en: '/en/', priority: '1.0' },
		{ id: '/blog', en: '/en/blog', priority: '0.9' },
	];

	const [idPosts, enPosts] = await Promise.all([getPosts('id'), getPosts('en')]);
	const enSlugs = new Set(enPosts.map(slugOf));
	for (const post of idPosts) {
		const slug = slugOf(post);
		if (!enSlugs.has(slug)) continue;
		entries.push({
			id: postPath('id', slug),
			en: postPath('en', slug),
			lastmod: post.data.updated ?? post.data.published,
			priority: '0.7',
		});
	}

	const pages = await getCollection('pages');
	for (const slug of new Set(pages.map((p) => p.id.split('/')[1]))) {
		const page = pages.find((p) => p.id === `id/${slug}`);
		entries.push({ id: `/${slug}`, en: `/en/${slug}`, lastmod: page?.data.updated, priority: '0.4' });
	}

	const cluster = (e: Entry) =>
		[
			`<xhtml:link rel="alternate" hreflang="id" href="${pageUrl(e.id)}"/>`,
			`<xhtml:link rel="alternate" hreflang="en" href="${pageUrl(e.en)}"/>`,
			`<xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(e.id)}"/>`,
		].join('\n    ');
	const urls = entries.flatMap((e) =>
		[e.id, e.en].map(
			(loc) => `  <url>
    <loc>${pageUrl(loc)}</loc>
    ${cluster(e)}${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''}
    <priority>${e.priority}</priority>
  </url>`,
		),
	);

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
	return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};

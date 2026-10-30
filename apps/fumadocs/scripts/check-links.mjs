// Post-build crawl of dist/: canonical equals the served URL (directory pages are
// served WITH a trailing slash), hreflang targets and internal links exist, and
// every sitemap URL is a real page. Run after `astro build` (bun run check:links).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const ORIGIN = 'https://docs.revklik.com';
const errors = [];
const fail = (msg) => errors.push(msg);

const walk = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));

const servedPath = (file) => {
	const rel = relative(DIST, file).split(sep).join('/');
	if (rel === 'index.html') return '/';
	return rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
};
const redirects = new Set(
	existsSync(join(DIST, '_redirects'))
		? readFileSync(join(DIST, '_redirects'), 'utf8')
				.split('\n')
				.filter((l) => l.trim() && !l.startsWith('#'))
				.map((l) => l.split(/\s+/)[0])
		: [],
);
const resolves = (path) => {
	if (redirects.has(path)) return false;
	if (path.endsWith('/')) return existsSync(join(DIST, path, 'index.html'));
	return existsSync(join(DIST, path)) && statSync(join(DIST, path)).isFile();
};
const served = new Set(htmlFiles.map(servedPath));
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

for (const file of htmlFiles) {
	const path = servedPath(file);
	const html = readFileSync(file, 'utf8');
	const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
	const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
	if (!noindex) {
		if (!canonical) fail(`${path}: missing canonical`);
		else if (canonical !== `${ORIGIN}${path}`) fail(`${path}: canonical ${canonical} != served URL`);
	}
	for (const tag of html.match(/<link rel="alternate" hreflang="[^"]+"[^>]*>/g) ?? []) {
		const href = attr(tag, 'href');
		if (!href?.startsWith(ORIGIN) || !served.has(href.slice(ORIGIN.length))) fail(`${path}: hreflang ${href} has no page`);
	}
	for (const tag of html.match(/<a [^>]*href="[^"]*"[^>]*>/g) ?? []) {
		const href = attr(tag, 'href').replace(/&amp;/g, '&');
		if (/^(mailto:|tel:|#|javascript:)/.test(href)) continue;
		let target = href;
		if (href.startsWith(ORIGIN)) target = href.slice(ORIGIN.length) || '/';
		else if (/^https?:\/\//.test(href)) continue;
		target = target.split('#')[0].split('?')[0];
		if (!target) continue;
		if (!resolves(target)) fail(`${path}: link ${href} does not resolve to a 200 page`);
	}
}

const sitemapFiles = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f));
let urls = 0;
for (const f of sitemapFiles) {
	for (const loc of readFileSync(join(DIST, f), 'utf8').match(/(?<=<loc>)[^<]+(?=<\/loc>)/g) ?? []) {
		urls++;
		if (!loc.startsWith(ORIGIN) || !resolves(loc.slice(ORIGIN.length))) fail(`sitemap: ${loc} does not resolve to a 200 page`);
	}
}
if (errors.length > 0) {
	console.error(`${errors.length} link problem(s):\n${errors.join('\n')}`);
	process.exit(1);
}
console.log(`ok: ${htmlFiles.length} pages, ${urls} sitemap URLs`);

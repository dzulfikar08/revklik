// Post-build crawl of dist/: every internal link resolves without a redirect,
// every canonical equals the URL the page is served at, every sitemap URL and
// hreflang target exists. Run after `astro build` (bun run check:links).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const ORIGIN = 'https://revklik.com';
const errors = [];
const fail = (msg) => errors.push(msg);

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
}
const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));

/** URL path a built html file is served at, following Cloudflare Pages pretty URLs. */
function servedPath(file) {
	const rel = relative(DIST, file).split(sep).join('/');
	if (rel === 'index.html') return '/';
	if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
	return `/${rel.slice(0, -'.html'.length)}`;
}

const redirects = new Set(
	existsSync(join(DIST, '_redirects'))
		? readFileSync(join(DIST, '_redirects'), 'utf8')
				.split('\n')
				.filter((l) => l.trim() && !l.startsWith('#'))
				.map((l) => l.split(/\s+/)[0])
		: [],
);

/** True when `path` is served with a 200 (no redirect hop) on Pages. */
function resolves(path) {
	if (path === '/') return true;
	if (redirects.has(path)) return false;
	if (path.endsWith('/')) return existsSync(join(DIST, path, 'index.html'));
	if (existsSync(join(DIST, `${path}.html`))) return true;
	return existsSync(join(DIST, path)) && statSync(join(DIST, path)).isFile();
}

const served = new Set(htmlFiles.map(servedPath));
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

for (const file of htmlFiles) {
	const path = servedPath(file);
	const html = readFileSync(file, 'utf8');
	const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);

	const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
	if (!noindex && path !== '/404') {
		if (!canonical) fail(`${path}: missing canonical`);
		else if (canonical !== `${ORIGIN}${path}`) fail(`${path}: canonical ${canonical} != served URL`);
	}

	for (const tag of html.match(/<link rel="alternate" hreflang="[^"]+"[^>]*>/g) ?? []) {
		const href = attr(tag, 'href');
		if (!href?.startsWith(ORIGIN)) fail(`${path}: hreflang ${href} is not absolute`);
		else if (!served.has(href.slice(ORIGIN.length))) fail(`${path}: hreflang ${href} has no page`);
	}

	for (const tag of html.match(/<a [^>]*href="[^"]*"[^>]*>/g) ?? []) {
		const href = attr(tag, 'href').replace(/&amp;/g, '&');
		if (/^(mailto:|tel:|#|javascript:)/.test(href)) continue;
		let target = href;
		if (href.startsWith(ORIGIN)) target = href.slice(ORIGIN.length) || '/';
		else if (/^https?:\/\//.test(href)) continue;
		target = target.split('#')[0].split('?')[0];
		if (!target) continue;
		if (/\.html(#|$)/.test(target)) fail(`${path}: link to .html URL ${href}`);
		else if (!resolves(target)) fail(`${path}: link ${href} does not resolve to a 200 page`);
	}
}

// Sitemap: every <loc> is a served page, and none is noindex.
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
for (const loc of sitemap.match(/(?<=<loc>)[^<]+(?=<\/loc>)/g) ?? []) {
	if (!loc.startsWith(ORIGIN)) fail(`sitemap: ${loc} is not on ${ORIGIN}`);
	else if (!resolves(loc.slice(ORIGIN.length))) fail(`sitemap: ${loc} does not resolve to a 200 page`);
}

if (errors.length > 0) {
	console.error(`${errors.length} link problem(s):\n${errors.join('\n')}`);
	process.exit(1);
}
console.log(`ok: ${htmlFiles.length} pages, ${[...sitemap.matchAll(/<loc>/g)].length} sitemap URLs`);

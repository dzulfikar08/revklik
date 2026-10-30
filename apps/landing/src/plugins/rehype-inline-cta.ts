import { EN, ID } from '../data/copy';
import { appLink, REGISTER_URL } from '../data/site';

type Node = {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: Node[];
	value?: string;
};

const el = (tagName: string, properties: Record<string, unknown>, children: Node[]): Node => ({
	type: 'element',
	tagName,
	properties,
	children,
});
const text = (value: string): Node => ({ type: 'text', value });

/**
 * Drops one sign-up prompt into each blog post, after the block that follows the
 * first H2, so readers meet a CTA before the end-of-post panel. The link is
 * UTM-tagged with the post slug and carries a goal for the tracker.
 */
export function rehypeInlineCta() {
	return (tree: Node, file: { path?: string; data?: { astro?: { frontmatter?: { lang?: string } } } }) => {
		const lang = file.data?.astro?.frontmatter?.lang === 'en' ? 'en' : 'id';
		const slug = (file.path ?? '').split('/').pop()?.replace(/\.md$/, '') ?? 'post';
		const c = lang === 'en' ? EN : ID;
		const href = appLink(REGISTER_URL, lang, { source: 'blog_inline', campaign: slug });
		const cta = el('aside', { className: ['inline-cta'] }, [
			el('p', {}, [text(c.cta_inline)]),
			el(
				'a',
				{
					className: ['btn', 'btn-primary', 'btn-sm'],
					href,
					'data-cta': '',
					'data-revklik-goal': 'register_click',
					'data-revklik-goal-location': 'blog_inline',
				},
				[text(c.cta_inline_btn)],
			),
		]);
		const kids = tree.children ?? [];
		const h2 = kids.findIndex((n) => n.type === 'element' && n.tagName === 'h2');
		if (h2 === -1) return;
		let at = h2 + 1;
		while (at < kids.length && kids[at].type === 'text') at++;
		// Insert after the first block that follows the heading (a paragraph or list).
		const insertAt = at < kids.length && kids[at].tagName !== 'h2' ? at + 1 : h2 + 1;
		kids.splice(insertAt, 0, cta);
	};
}

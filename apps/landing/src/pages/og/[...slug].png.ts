import type { APIRoute } from 'astro';
import { createElement, type ReactNode } from 'react';
import { ImageResponse } from 'takumi-js/response';
import { EN, ID, type Locale } from '../../data/copy';
import { CATEGORY_LABEL, getPosts, slugOf, type Category } from '../../lib/blog';

// 1200x630 PNG share cards (X and WhatsApp ignore or mangle WebP). Colors are the
// landing palette flattened to hex so the renderer never parses oklch().
const BRAND = {
	background: '#0b0e14',
	foreground: '#edf0f4',
	muted: '#949aa3',
	border: '#242931',
	accent: '#f7a062',
	money: '#e9c46a',
} as const;

type Card = { kicker: string; title: string; footer: string };

type CardProps =
	| { kind: 'home'; locale: Locale }
	| { kind: 'post'; locale: Locale; title: string; category: Category };

export async function getStaticPaths() {
	const posts = (await Promise.all((['id', 'en'] as const).map((l) => getPosts(l)))).flat();
	const paths: { params: { slug: string }; props: CardProps }[] = [
		{ params: { slug: 'home/id' }, props: { kind: 'home', locale: 'id' } },
		{ params: { slug: 'home/en' }, props: { kind: 'home', locale: 'en' } },
	];
	for (const p of posts) {
		paths.push({
			params: { slug: `blog/${p.data.lang}/${slugOf(p)}` },
			props: { kind: 'post', locale: p.data.lang, title: p.data.title, category: p.data.category },
		});
	}
	return paths;
}

const el = (tag: string, style: Record<string, string | number>, ...children: ReactNode[]) =>
	createElement(tag, { style }, ...children);

function CardView({ kicker, title, footer }: Card) {
	return el(
		'div',
		{
			display: 'flex',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			padding: '64px 72px 56px',
			backgroundColor: BRAND.background,
			borderBottom: `14px solid ${BRAND.accent}`,
			color: BRAND.foreground,
		},
		el(
			'div',
			{ display: 'flex', alignItems: 'baseline', gap: '2px' },
			el('span', { fontSize: '44px', fontWeight: 800, letterSpacing: '-1px' }, 'Rev'),
			el('span', { fontSize: '44px', fontWeight: 800, color: BRAND.accent }, 'Klik'),
			kicker ? el('span', { fontSize: '28px', fontWeight: 500, color: BRAND.muted, marginLeft: '24px' }, kicker) : '',
		),
		el(
			'div',
			{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 },
			el('div', { fontSize: title.length > 70 ? '56px' : '68px', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-1.5px' }, title),
		),
		el(
			'div',
			{ display: 'flex', alignItems: 'center', borderTop: `2px solid ${BRAND.border}`, paddingTop: '26px' },
			el('span', { fontSize: '28px', fontWeight: 600, color: BRAND.money }, footer),
		),
	);
}

export const GET: APIRoute = ({ props }) => {
	const p = props as CardProps;
	const c = p.locale === 'en' ? EN : ID;
	const card: Card =
		p.kind === 'home'
			? { kicker: '', title: `${c.hero_title[0]}${c.hero_title[1]}`, footer: p.locale === 'en' ? 'revklik.com/en' : 'revklik.com' }
			: {
					kicker: CATEGORY_LABEL[p.locale][p.category],
					title: p.title,
					footer: `revklik.com/${p.locale === 'en' ? 'en/' : ''}blog`,
				};
	return new ImageResponse(createElement(CardView, card), { width: 1200, height: 630, format: 'png' });
};

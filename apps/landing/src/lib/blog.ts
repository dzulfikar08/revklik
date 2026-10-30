import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '../data/copy';

export type Post = CollectionEntry<'blog'>;
export type Category = Post['data']['category'];

export const CATEGORIES: readonly Category[] = ['revenue', 'privacy', 'guide', 'compare', 'tech'];

export const CATEGORY_LABEL: Record<Locale, Record<Category, string>> = {
	id: { privacy: 'Privasi', guide: 'Panduan', tech: 'Teknologi', revenue: 'Revenue', compare: 'Perbandingan' },
	en: { privacy: 'Privacy', guide: 'Guides', tech: 'Technology', revenue: 'Revenue', compare: 'Comparisons' },
};

/** `id/atribusi-pendapatan` -> `atribusi-pendapatan` */
export const slugOf = (post: Post): string => post.id.split('/').pop() ?? post.id;

export function postPath(locale: Locale, slug: string): string {
	return locale === 'en' ? `/en/blog/${slug}` : `/blog/${slug}`;
}

/** Published posts of one language, newest first. */
export async function getPosts(locale: Locale): Promise<Post[]> {
	const all = await getCollection('blog', (p) => p.data.lang === locale && !p.data.draft);
	return all.sort((a, b) => b.data.published.localeCompare(a.data.published));
}

export async function hasTranslation(locale: Locale, slug: string): Promise<boolean> {
	const other = await getCollection('blog', (p) => p.data.lang === locale && !p.data.draft);
	return other.some((p) => slugOf(p) === slug);
}

export function formatDate(iso: string, locale: Locale): string {
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

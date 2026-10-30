import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

// YAML turns an unquoted `2026-09-16` into a Date; keep dates as ISO strings.
const isoDate = z
	.union([z.date(), z.string()])
	.transform((v) => (typeof v === 'string' ? v : v.toISOString().slice(0, 10)))
	.pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

// One file per post and language: src/content/blog/<lang>/<slug>.md. The same slug
// in both languages is a translation pair (hreflang + language switch).
const blog = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
	schema: z.object({
		lang: z.enum(['id', 'en']),
		title: z.string(),
		description: z.string(),
		/** Shorter text for social cards; falls back to `description`. */
		ogDescription: z.string().optional(),
		published: isoDate,
		updated: isoDate.optional(),
		readMinutes: z.number().int().positive(),
		category: z.enum(['privacy', 'guide', 'tech', 'revenue', 'compare']),
		featured: z.boolean().default(false),
		/** Slugs of related posts in the same language. */
		related: z.array(z.string()).default([]),
		/** Unpublished posts are not built, listed, or put in the sitemap. */
		draft: z.boolean().default(false),
	}),
});


// Long-form site pages (privacy, terms, support): src/content/pages/<lang>/<slug>.md.
const pages = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
	schema: z.object({
		lang: z.enum(['id', 'en']),
		title: z.string(),
		description: z.string(),
		updated: isoDate.optional(),
	}),
});

export const collections = { blog, pages };

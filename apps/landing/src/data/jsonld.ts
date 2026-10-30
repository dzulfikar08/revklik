import catalog from '../../../../packages/shared/marketing/catalog.json';
import type { Copy, Locale } from './copy';
import { ORIGIN, pageUrl } from './seo';

/** Structured data for a locale home: SoftwareApplication, Organization, FAQPage. */
export function homeJsonLd(c: Copy, locale: Locale, path: string): object[] {
	return [
		{
			'@context': 'https://schema.org',
			'@type': 'SoftwareApplication',
			name: 'RevKlik',
			url: pageUrl(path),
			inLanguage: locale,
			applicationCategory: 'BusinessApplication',
			operatingSystem: 'Web',
			description: c.ld_description,
			offers: catalog.plans.map((p, i) => ({
				'@type': 'Offer',
				name: p.name,
				price: String(p.idr),
				priceCurrency: 'IDR',
				description: c.ld_offers[i],
			})),
			featureList: c.ld_features,
		},
		organizationJsonLd(c),
		{
			'@context': 'https://schema.org',
			'@type': 'FAQPage',
			inLanguage: locale,
			mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
		},
	];
}

export function organizationJsonLd(c: Copy): object {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		name: 'RevKlik',
		url: ORIGIN,
		logo: `${ORIGIN}/revklik.webp`,
		description: c.ld_org_description,
		parentOrganization: { '@type': 'Organization', name: 'Joyo Digitama', url: 'https://voltrus.id' },
	};
}

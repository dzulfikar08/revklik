const TRACKER_TAG = /<script\b[^>]*\bdata-site-id=[^>]*>/u;
const CONSENT_ATTR = /\sdata-consent=/u;
const REQUIRED_ATTR = ' data-consent="required"';

/**
 * Adds `data-consent="required"` to the tracker's script tag so the tracker
 * stays silent until the visitor accepts (`klikapa.consent(true)`). A snippet
 * without the tracker tag, or one that already sets data-consent, is returned
 * unchanged.
 */
export const withConsentRequired = (snippet: string): string => {
	const tag = TRACKER_TAG.exec(snippet)?.[0];
	if (!tag || CONSENT_ATTR.test(tag)) {
		return snippet;
	}
	return snippet.replace(
		tag,
		tag.replace(/\s*\/?>$/u, (end) => `${REQUIRED_ATTR}${end}`),
	);
};

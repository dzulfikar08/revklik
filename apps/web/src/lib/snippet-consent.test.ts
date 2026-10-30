import { describe, expect, it } from "vitest";

import { withConsentRequired } from "./snippet-consent";

const SNIPPET =
	'<script defer src="https://app.revklik.com/klikapa.js" data-site-id="abc-123"></script>';

describe("withConsentRequired", () => {
	it("adds the consent attribute to the tracker tag", () => {
		expect(withConsentRequired(SNIPPET)).toBe(
			'<script defer src="https://app.revklik.com/klikapa.js" data-site-id="abc-123" data-consent="required"></script>',
		);
	});

	it("leaves a snippet that already sets data-consent alone", () => {
		const done = SNIPPET.replace("></script>", ' data-consent="required"></script>');
		expect(withConsentRequired(done)).toBe(done);
	});

	it("ignores text with no tracker tag", () => {
		expect(withConsentRequired("loading")).toBe("loading");
	});
});

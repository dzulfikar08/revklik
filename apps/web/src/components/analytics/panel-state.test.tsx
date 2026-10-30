import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegacyApiError } from "@/lib/legacy/api";
import { loadErrorKey } from "@/lib/load-error";

import { PanelState } from "./panel-state";

const render = (props: Partial<Parameters<typeof PanelState>[0]>) =>
	renderToString(
		<PanelState loading={false} hasData={false} emptyText="No visits yet." {...props}>
			<p>rows</p>
		</PanelState>,
	);

describe("PanelState", () => {
	it("says the load failed, with a retry button, instead of 'no data'", () => {
		const html = render({ error: new TypeError("Failed to fetch"), onRetry: () => undefined });
		expect(html).toContain("Try again");
		expect(html).toContain("can&#x27;t be reached");
		expect(html).not.toContain("No visits yet.");
		expect(html).not.toContain("Failed to fetch");
	});

	it("keeps showing loaded rows when only a background refetch failed", () => {
		const html = render({ error: new Error("x"), hasData: true, onRetry: () => undefined });
		expect(html).toContain("rows");
		expect(html).not.toContain("Try again");
	});

	it("shows the empty cause and its one action when nothing is there", () => {
		const html = render({ emptyAction: { label: "Try 30d", onClick: () => undefined } });
		expect(html).toContain("No visits yet.");
		expect(html).toContain("Try 30d");
	});

	it("shows a skeleton while loading, not the empty text", () => {
		const html = render({ loading: true });
		expect(html).not.toContain("No visits yet.");
		expect(html).toContain('role="status"');
	});
});

describe("loadErrorKey", () => {
	it("maps server and rate-limit failures to their own copy", () => {
		expect(loadErrorKey(new LegacyApiError("x", 500))).toBe("state.errorServer");
		expect(loadErrorKey(new LegacyApiError("x", 429))).toBe("state.errorBusy");
		expect(loadErrorKey(new LegacyApiError("x", 404))).toBe("state.errorGeneric");
	});
});

/**
 * Regression: the Share view once read a remembered `kp_active_site` and
 * acted on a different site than the one in the URL (deep links, a second
 * tab). Whatever is remembered, the URL's site must drive every request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const share = vi.hoisted(() => ({
	fetchShareStatus: vi.fn(),
	fetchWidgetStatus: vi.fn(),
}));

vi.mock("@/lib/legacy/share-widget-tokens", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/legacy/share-widget-tokens")>()),
	fetchApiTokens: vi.fn().mockResolvedValue([]),
	fetchShareStatus: share.fetchShareStatus,
	fetchSubscriptionPlan: vi.fn().mockResolvedValue({ plan: "growth" }),
	fetchWidgetStatus: share.fetchWidgetStatus,
}));
vi.mock("@/lib/legacy/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/legacy/api")>()),
	fetchSites: vi.fn().mockResolvedValue([
		{ domain: "joyorogo.com", id: "site-url", name: "JoyoRogo" },
		{ domain: "cloudagni.id", id: "site-stale", name: "Cloudagni" },
	]),
}));

import { ShareWidgetTokensView } from "./share-widget-tokens";

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("ShareWidgetTokensView", () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		share.fetchShareStatus.mockResolvedValue({ public: false, share_token: null });
		share.fetchWidgetStatus.mockResolvedValue({ enabled: false, tz_offset: 420, widget_token: null });
		container = document.createElement("div");
		document.body.append(container);
	});

	afterEach(() => {
		container.remove();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("queries share and widget state for the URL site, not the remembered one", async () => {
		localStorage.setItem("kp_active_site", "site-stale");
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<ShareWidgetTokensView siteId="site-url" />
				</QueryClientProvider>,
			);
		});
		await flush();

		expect(share.fetchShareStatus).toHaveBeenCalledWith("site-url");
		expect(share.fetchWidgetStatus).toHaveBeenCalledWith("site-url");
		expect(share.fetchShareStatus).not.toHaveBeenCalledWith("site-stale");
		expect(container.textContent).toContain("joyorogo.com");
		expect(container.textContent).not.toContain("cloudagni.id");
		await act(async () => root.unmount());
	});
});

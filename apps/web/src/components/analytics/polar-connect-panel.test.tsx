/**
 * Offline render tests for the Connect Polar panel: the per-site webhook URL, the
 * events to tick, secret handling (saved state only, never a value) and the states
 * the owner has to act on.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PolarStatus } from "@/lib/legacy/integrations";

import { PolarConnectPanel } from "./polar-connect-panel";

const SITE = "e705a4ef-6321-447b-92bb-8cd591481123";

const status = (over: Partial<PolarStatus> = {}): PolarStatus => ({
	access_token_configured: false,
	connected: false,
	events: [],
	last_sync_at: null,
	last_sync_error: "",
	last_sync_summary: "",
	organization_id: "",
	site_id: SITE,
	webhook_secret_configured: false,
	webhook_url: `https://app.revklik.com/api/webhooks/polar?site_id=${SITE}`,
	...over,
});

const render = (data: PolarStatus | undefined, siteId = SITE) => {
	const client = new QueryClient();
	if (data) client.setQueryData(["legacy", "polar", siteId], data);
	return renderToString(
		<QueryClientProvider client={client}>
			<PolarConnectPanel siteId={siteId} />
		</QueryClientProvider>,
	);
};

describe("Connect Polar panel", () => {
	it("shows the site's own webhook URL, the events to tick and the Raw format", () => {
		const html = render(status());
		expect(html).toContain(`https://app.revklik.com/api/webhooks/polar?site_id=${SITE}`);
		expect(html).not.toContain("/api/billing/webhook");
		expect(html).toContain("order.paid");
		expect(html).toContain("order.refunded");
		expect(html).toContain("Leave Format on Raw");
		expect(html).toContain("https://polar.sh/to/dashboard/settings/webhooks");
		expect(html).toContain("orders:read");
		expect(html).not.toContain("subscriptions:read");
	});

	it("starts as not connected, with the sync turned off until a token is saved", () => {
		const html = render(status());
		expect(html).toContain("Not connected");
		expect(html).toContain("Save secret");
		expect(html).toContain("Save an access token to turn this on.");
		expect(html).toContain("Deliveries appear here once the endpoint exists in Polar");
		expect(html).not.toContain("Disconnect Polar");
	});

	it("shows a saved secret and token as saved, never as a value", () => {
		const html = render(
			status({
				access_token_configured: true,
				connected: true,
				last_sync_at: new Date().toISOString(),
				last_sync_summary: "2 new, 0 updated, 5 unchanged",
				webhook_secret_configured: true,
			}),
		);
		expect(html).toContain("Replace secret");
		expect(html).toContain("Remove token");
		expect(html).toContain("Disconnect Polar");
		expect(html).toContain("2 new, 0 updated, 5 unchanged");
		expect(html).toContain("Waiting for first event");
		expect(html).toContain("Nothing received yet.");
		expect(html).not.toContain("Save an access token to turn this on.");
		expect(html.match(/type="password"/g)).toHaveLength(2);
		// The inputs are write-only: no value attribute carries a stored secret.
		expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
	});

	it("reports the last deliveries and flags a signature mismatch", () => {
		const html = render(
			status({
				connected: true,
				events: [
					{
						created_at: new Date().toISOString(),
						event_type: "polar_invalid_sig",
						id: "e2",
						status: "failed",
					},
					{
						created_at: new Date(Date.now() - 3_600_000).toISOString(),
						event_type: "polar_order.paid",
						id: "e1",
						status: "processed",
					},
				],
				webhook_secret_configured: true,
			}),
		);
		expect(html).toContain("Signature mismatch");
		expect(html).toContain("the signature did not match");
		expect(html).toContain("order.paid");
		expect(html).toContain("processed");
	});

	it("reads Receiving once an order event was processed", () => {
		const html = render(
			status({
				connected: true,
				events: [
					{
						created_at: new Date().toISOString(),
						event_type: "polar_order.refunded",
						id: "e1",
						status: "processed",
					},
				],
				webhook_secret_configured: true,
			}),
		);
		expect(html).toContain("Receiving");
		expect(html).not.toContain("Signature mismatch");
	});

	it("shows a loading placeholder before the status arrives", () => {
		const html = render(undefined);
		expect(html).toContain("Loading the Polar connection");
	});
});

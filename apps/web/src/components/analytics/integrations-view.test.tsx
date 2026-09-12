/**
 * Offline render tests for the App Store Connect integration form:
 * the acquisition instructions and all config fields must be present before
 * anyone is asked to paste credentials.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IntegrationsView, IntegrationForm, WEBHOOK_PROVIDERS } from "./integrations-view";

const ascMeta = WEBHOOK_PROVIDERS.find((p) => p.type === "appstoreconnect");
if (!ascMeta) throw new Error("appstoreconnect provider meta missing");

const render = (ui: React.ReactElement) =>
  renderToString(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("App Store Connect integration form", () => {
  it("is listed as a webhook-style provider card", () => {
    const html = render(<IntegrationsView siteId="s1" />);
    expect(html).toContain("App Store Connect");
    expect(html).toContain("Sync App Store downloads, proceeds, and price changes");
  });

  it("renders step-by-step instructions for every required value", () => {
    const html = render(
      <IntegrationForm meta={ascMeta} integration={null} siteId="s1" onDone={() => {}} />,
    );
    expect(html).toContain("Step 1 — create an API key");
    expect(html).toContain("Step 2 — app and vendor numbers");
    expect(html).toContain("Users and Access → Integrations");
    expect(html).toContain("Paid Applications Agreement");
    expect(html).toContain("download it exactly once");
    expect(html).toContain("App Information → Apple ID");
    expect(html).toContain("top-left corner, under your Legal Entity Name");
  });

  it("renders all config fields with the .p8 as a textarea", () => {
    const html = render(
      <IntegrationForm meta={ascMeta} integration={null} siteId="s1" onDone={() => {}} />,
    );
    for (const field of ascMeta.fields) {
      expect(html).toContain(field.label);
    }
    expect(html).toContain("<textarea");
    expect(html).toContain("-----BEGIN PRIVATE KEY-----");
    expect(html).toContain("Payments and Financial Reports");
  });
});

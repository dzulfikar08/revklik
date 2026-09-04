/**
 * Client for the klikapa integrations surface: webhook integrations, payment
 * providers, marketplace (Shopee/Tokopedia), Google Search Console, and data
 * imports. Shapes mirror the production worker routes.
 */
import { LEGACY_API_BASE, legacyFetch } from "./api";

export type LegacyIntegrationType =
  | "mailchimp"
  | "convertkit"
  | "kit"
  | "beehiiv"
  | "meta_ads"
  | "google_ads"
  | "google_search_console"
  | "midtrans"
  | "xendit"
  | "doku"
  | "nicepay"
  | "stripe"
  | "lemonsqueezy"
  | "shopee"
  | "tokopedia";

/** Origin of the production klikapa worker — webhook targets and OAuth live there. */
export const WORKER_ORIGIN = LEGACY_API_BASE.replace(/\/api\/?$/, "");

export interface LegacyIntegration {
  id: string;
  site_id: string;
  type: LegacyIntegrationType;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  last_sync: string | null;
  created_at: string;
}

export interface LegacyWebhookEvent {
  id: string;
  integration_id: string;
  direction: "inbound" | "outbound";
  event_type: string;
  status: "pending" | "processed" | "failed";
  created_at: string;
}

export interface LegacyPaymentProvider {
  id: string;
  site_id: string;
  provider: string;
  config: Record<string, string>;
  enabled: boolean;
  created_at: string;
}

export interface LegacyMarketplaceOrder {
  id: string;
  site_id: string;
  marketplace: "shopee" | "tokopedia";
  order_id: string;
  order_sn: string;
  amount: number;
  currency: string;
  status: string;
  buyer_info: string | null;
  items: string | null;
  ordered_at: string;
  synced_at: string;
}

export interface GscQueryRow {
  query: string;
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
  detail?: string;
}

export interface PolarImportResult {
  imported: number;
  skipped: number;
}

export interface OdsImportResult {
  imported: number;
  note: string;
}

export interface CreateIntegrationPayload {
  site_id: string;
  type: LegacyIntegrationType;
  name: string;
  config: Record<string, string>;
}

/* ------------------------------- integrations ------------------------------ */

export const fetchIntegrations = (
  siteId: string
): Promise<LegacyIntegration[]> =>
  legacyFetch(`/integrations?site_id=${encodeURIComponent(siteId)}`);

export const createIntegration = (
  data: CreateIntegrationPayload
): Promise<LegacyIntegration> =>
  legacyFetch("/integrations", {
    body: JSON.stringify(data),
    method: "POST",
  });

export const updateIntegration = (
  id: string,
  data: Partial<Pick<LegacyIntegration, "name" | "config" | "enabled">>
): Promise<LegacyIntegration> =>
  legacyFetch(`/integrations/${id}`, {
    body: JSON.stringify(data),
    method: "PATCH",
  });

export const deleteIntegration = (id: string): Promise<void> =>
  legacyFetch(`/integrations/${id}`, { method: "DELETE" });

export const testIntegration = (id: string): Promise<IntegrationTestResult> =>
  legacyFetch(`/integrations/${id}/test`, { method: "POST" });

export const fetchWebhookEvents = (
  integrationId: string
): Promise<LegacyWebhookEvent[]> =>
  legacyFetch(`/integrations/${integrationId}/events`);

/* ---------------------------- payment providers ---------------------------- */

export const fetchPaymentProviders = (
  siteId: string
): Promise<LegacyPaymentProvider[]> =>
  legacyFetch(`/payment-providers?site_id=${encodeURIComponent(siteId)}`);

export const createPaymentProvider = (
  siteId: string,
  provider: string,
  config: Record<string, string>
): Promise<{ id: string; provider: string; enabled: boolean }> =>
  legacyFetch("/payment-providers", {
    body: JSON.stringify({ site_id: siteId, provider, config }),
    method: "POST",
  });

export const deletePaymentProvider = (
  siteId: string,
  provider: string
): Promise<void> =>
  legacyFetch(`/payment-providers/${provider}?site_id=${encodeURIComponent(siteId)}`, {
    method: "DELETE",
  });

/* -------------------------- Google Search Console -------------------------- */

/** Start URL for the Google OAuth flow — the worker answers with a redirect. */
export const gscAuthUrl = (siteId: string): string =>
  `${LEGACY_API_BASE}/gsc/auth?site_id=${encodeURIComponent(siteId)}`;

export const syncGsc = (siteId: string): Promise<{ synced: number }> =>
  legacyFetch(`/gsc/sync?site_id=${encodeURIComponent(siteId)}`, {
    method: "POST",
  });

export const fetchGscQueries = (siteId: string): Promise<GscQueryRow[]> =>
  legacyFetch(`/gsc/queries?site_id=${encodeURIComponent(siteId)}`);

/* -------------------------------- marketplace ------------------------------ */

export type Marketplace = "shopee" | "tokopedia";

/** Start URL for the marketplace OAuth flow — the worker answers with a redirect. */
export const marketplaceAuthUrl = (
  marketplace: Marketplace,
  siteId: string
): string =>
  `${LEGACY_API_BASE}/marketplace/${marketplace}/auth?site_id=${encodeURIComponent(siteId)}`;

export const syncMarketplaceOrders = (
  marketplace: Marketplace,
  siteId: string
): Promise<void> =>
  legacyFetch(`/marketplace/${marketplace}/sync?site_id=${encodeURIComponent(siteId)}`, {
    method: "POST",
  });

export const fetchMarketplaceOrders = (
  marketplace: Marketplace,
  siteId: string
): Promise<LegacyMarketplaceOrder[]> =>
  legacyFetch(`/marketplace/${marketplace}/orders?site_id=${encodeURIComponent(siteId)}`);

/* ---------------------------------- imports -------------------------------- */

export const importPolarOrders = (
  siteId: string,
  polarToken: string,
  polarOrgId?: string
): Promise<PolarImportResult> =>
  legacyFetch("/import/polar-orders", {
    body: JSON.stringify({
      site_id: siteId,
      polar_token: polarToken,
      polar_org_id: polarOrgId,
    }),
    method: "POST",
  });

export const importOneDollarStats = (
  siteId: string,
  apiKey: string,
  odsSiteId: string,
  dateRange = "all"
): Promise<OdsImportResult> =>
  legacyFetch("/import/onedollarstats", {
    body: JSON.stringify({
      site_id: siteId,
      api_key: apiKey,
      ods_site_id: odsSiteId,
      date_range: dateRange,
    }),
    method: "POST",
  });

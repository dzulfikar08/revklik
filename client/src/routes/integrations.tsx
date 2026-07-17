import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchIntegrations, createIntegration, updateIntegration,
  deleteIntegration, testIntegration,
  fetchPaymentProviders, createPaymentProvider, deletePaymentProvider,
  getActiveSiteId, setActiveSiteId, fetchSites, getGSCAuthUrl, syncGSC,
  getShopeeAuthUrl, getTokopediaAuthUrl,
} from "@/lib/api";
import type { Integration, IntegrationType } from "shared";
import { t } from "@/lib/i18n";
import { PROVIDERS, PAYMENT_PROVIDERS, MARKETPLACE_PROVIDERS } from "@/components/integrations/provider-config";
import { MarketplaceOrdersSection } from "@/components/integrations/marketplace-orders";
import { WebhookUrlSection } from "@/components/integrations/webhook-url-section";
import { EventLogTable } from "@/components/integrations/event-log";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/integrations")({ component: IntegrationsPage });

function ProviderIcon({ type, connected }: { type: IntegrationType; connected: boolean }) {
  const provider = PROVIDERS.find((p) => p.type === type);
  const bgColor = connected ? "var(--green-dim)" : "var(--bg3)";
  const textColor = connected ? "var(--green)" : "var(--text3)";
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, fontSize: 20,
      background: bgColor, color: textColor, flexShrink: 0,
    }}>
      {provider?.icon ?? "?"}
    </div>
  );
}

function ConfigModal({
  provider,
  integration,
  onClose,
}: {
  provider: typeof PROVIDERS[number];
  integration: Integration | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const siteId = getActiveSiteId() ?? "";
  const isEdit = !!integration;

  const [form, setForm] = useState<Record<string, string>>(() => {
    if (integration) {
      // When editing, config values are masked; start with empty strings
      const initial: Record<string, string> = {};
      for (const field of provider.fields) {
        initial[field.key] = "";
      }
      return initial;
    }
    const initial: Record<string, string> = {};
    for (const field of provider.fields) {
      initial[field.key] = "";
    }
    return initial;
  });
  const [name, setName] = useState(integration?.name ?? provider.name);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      if (PAYMENT_PROVIDERS.includes(provider.type)) {
        await createPaymentProvider(siteId, provider.type, form);
        return null;
      }
      return createIntegration({ site_id: siteId, type: provider.type, name, config: form });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["payment-providers"] });
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      // Only send config fields that have been filled in (non-empty)
      const configToUpdate = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      const payload: Record<string, unknown> = { name };
      if (Object.keys(configToUpdate).length > 0) payload.config = configToUpdate;
      return updateIntegration(integration!.id, payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["integrations"] }); onClose(); },
    onError: (err) => setError(err.message),
  });

  const handleTest = async () => {
    if (PAYMENT_PROVIDERS.includes(provider.type)) {
      setTestResult({ ok: true, message: "Payment provider test is not available yet" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // If not yet created, create first then test
      let id = integration?.id;
      if (!id) {
        const result = await createIntegration({ site_id: siteId, type: provider.type, name, config: form });
        id = (result as Integration).id;
        queryClient.invalidateQueries({ queryKey: ["integrations"] });
      }
      const result = await testIntegration(id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)" }} onClick={onClose}>
      <div style={{ width: 440, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 16, padding: 24, animation: "fadeUp 0.25s cubic-bezier(0.16,1,0.3,1)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ProviderIcon type={provider.type} connected={!!integration} />
            <div>
              <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 20, color: "var(--text)" }}>{provider.name}</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{isEdit ? t("integrations.update_config") : t("integrations.setup")}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 16, color: "var(--text3)", padding: "4px 8px" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {error && <div style={{ fontSize: 12, color: "var(--crit)", background: "var(--crit-dim)", borderRadius: 8, padding: "10px 14px" }}>{error}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={provider.name} style={{ width: "100%" }} />
          </div>

          {provider.fields.map((field) => (
            <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{field.label}</label>
              <input
                type={field.secret ? "password" : "text"}
                value={form[field.key] ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={isEdit ? t("integrations.keep_current") : field.placeholder}
                style={{ width: "100%" }}
              />
            </div>
          ))}

          {testResult && (
            <div style={{ fontSize: 12, color: testResult.ok ? "var(--green)" : "var(--crit)", background: testResult.ok ? "var(--green-dim)" : "var(--crit-dim)", borderRadius: 8, padding: "10px 14px" }}>
              {testResult.message}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {isEdit ? (
              <button className="btn-accent" onClick={() => updateMut.mutate()} disabled={updateMut.isPending} style={{ opacity: updateMut.isPending ? 0.6 : 1 }}>
                {updateMut.isPending ? t("integrations.saving") : t("integrations.save_changes")}
              </button>
            ) : (
              <button className="btn-accent" onClick={() => createMut.mutate()} disabled={createMut.isPending} style={{ opacity: createMut.isPending ? 0.6 : 1 }}>
                {createMut.isPending ? t("integrations.connecting") : t("integrations.connect")}
              </button>
            )}
            <button className="btn-pill" onClick={handleTest} disabled={testing}>
              {testing ? t("integrations.testing") : t("integrations.test")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationsPage() {
  const siteId = getActiveSiteId() ?? "";
  const queryClient = useQueryClient();
  const [configProvider, setConfigProvider] = useState<typeof PROVIDERS[number] | null>(null);
  const [configIntegration, setConfigIntegration] = useState<Integration | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => fetchIntegrations(siteId),
    enabled: !!siteId,
  });

  const { data: paymentProviders } = useQuery({
    queryKey: ["payment-providers", siteId],
    queryFn: () => fetchPaymentProviders(siteId),
    enabled: !!siteId,
  });

  // Sites for the inline picker shown when no site is active yet.
  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: () => fetchSites(),
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, type, providerSiteId }: { id: string; type: string; providerSiteId?: string }) => {
      if (PAYMENT_PROVIDERS.includes(type) && providerSiteId) {
        return deletePaymentProvider(providerSiteId, type);
      }
      return deleteIntegration(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["payment-providers"] });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateIntegration(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });

  if (!siteId) {
    return (
      <div className="empty-state" style={{ flex: 1, alignItems: "center" }}>
        <p>{t("sites.select_site")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, minWidth: 280 }}>
          {(sites ?? []).map((s) => (
            <button key={s.id} className="btn-pill" style={{ justifyContent: "flex-start" }}
              onClick={() => { setActiveSiteId(s.id); window.location.reload(); }}>
              {s.name}
            </button>
          ))}
          {sites && sites.length === 0 && <p style={{ opacity: 0.6 }}>No sites yet.</p>}
        </div>
      </div>
    );
  }

  const integrationMap = new Map<string, Integration>(
    (integrations ?? []).map((i) => [i.type, i])
  );

  // Merge payment providers into the map so they appear as connected
  for (const pp of paymentProviders ?? []) {
    if (!integrationMap.has(pp.provider)) {
      integrationMap.set(pp.provider, {
        id: pp.id,
        site_id: pp.site_id,
        type: pp.provider as IntegrationType,
        name: pp.provider,
        config: pp.config,
        enabled: pp.enabled,
        last_sync: null,
        created_at: pp.created_at,
      });
    }
  }

  const handleConfigure = (provider: typeof PROVIDERS[number]) => {
    const existing = integrationMap.get(provider.type);
    setConfigProvider(provider);
    setConfigIntegration(existing ?? null);
  };

  const handleDisconnect = (integration: Integration) => {
    if (!confirm(`Disconnect ${integration.name}?`)) return;
    deleteMut.mutate({ id: integration.id, type: integration.type, providerSiteId: integration.site_id });
    if (selectedIntegration === integration.id) setSelectedIntegration(null);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="overview-scroll">
        <PageHeader
          title={t("integrations.title")}
          subtitle={t("integrations.subtitle")}
          backTo="/site/$siteId"
        />

        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
            <div className="spinner" />
          </div>
        ) : (
          <div className="site-cards-grid">
            {PROVIDERS.map((provider, i) => {
              const integration = integrationMap.get(provider.type);
              const connected = !!integration;
              const enabled = integration?.enabled ?? false;

              return (
                <div key={provider.type} className="site-card" style={{ animationDelay: `${i * 60}ms` }}>
                  <div style={{ padding: "18px 22px 0" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <ProviderIcon type={provider.type} connected={connected && enabled} />
                        <div>
                          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text)" }}>{provider.name}</div>
                          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{provider.description}</div>
                        </div>
                      </div>
                      {connected && (
                        <span style={{
                          fontFamily: "var(--mono)", fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: "0.06em", padding: "4px 10px", borderRadius: 100,
                          background: enabled ? "var(--green-dim)" : "var(--bg3)",
                          color: enabled ? "var(--green)" : "var(--text3)",
                          border: `1px solid ${enabled ? "rgba(52,211,153,.2)" : "var(--border2)"}`,
                          whiteSpace: "nowrap",
                        }}>
                          {enabled ? t("integrations.connected") : t("integrations.disabled")}
                        </span>
                      )}
                    </div>
                  </div>

                  {connected && integration!.last_sync && (
                    <div style={{ padding: "8px 22px 0", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text4)" }}>
                      Last sync: {new Date(integration!.last_sync!).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}

                  {connected && PAYMENT_PROVIDERS.includes(provider.type) && (
                    <WebhookUrlSection provider={provider.type} />
                  )}

                  <div style={{ padding: "16px 22px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {provider.type === "google_search_console" ? (
                      connected ? (
                        <>
                          <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                            onClick={() => { window.location.href = getGSCAuthUrl(siteId); }}>
                            Re-authorize
                          </button>
                          <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px" }}
                            onClick={async () => { try { await syncGSC(siteId); queryClient.invalidateQueries({ queryKey: ["integrations"] }); } catch (err) { /* toast handled by apiFetch */ } }}>
                            Sync Now
                          </button>
                          <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }}
                            onClick={() => handleDisconnect(integration!)}>
                            {t("integrations.disconnect")}
                          </button>
                        </>
                      ) : (
                        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => { window.location.href = getGSCAuthUrl(siteId); }}>
                          Authorize with Google
                        </button>
                      )
                    ) : provider.type === "shopee" ? (
                      connected ? (
                        <>
                          <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                            onClick={() => { window.location.href = getShopeeAuthUrl(siteId); }}>
                            Re-authorize
                          </button>
                          <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }}
                            onClick={() => handleDisconnect(integration!)}>
                            {t("integrations.disconnect")}
                          </button>
                        </>
                      ) : (
                        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => { window.location.href = getShopeeAuthUrl(siteId); }}>
                          Connect with Shopee
                        </button>
                      )
                    ) : provider.type === "tokopedia" ? (
                      connected ? (
                        <>
                          <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                            onClick={() => { window.location.href = getTokopediaAuthUrl(siteId); }}>
                            Re-authorize
                          </button>
                          <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }}
                            onClick={() => handleDisconnect(integration!)}>
                            {t("integrations.disconnect")}
                          </button>
                        </>
                      ) : (
                        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => { window.location.href = getTokopediaAuthUrl(siteId); }}>
                          Connect with Tokopedia
                        </button>
                      )
                    ) : (
                      <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                        onClick={() => handleConfigure(provider)}>
                        {connected ? t("integrations.configure") : t("integrations.connect")}
                      </button>
                    )}
                    {connected && provider.type !== "google_search_console" && !MARKETPLACE_PROVIDERS.includes(provider.type) && (
                      <>
                        <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => toggleMut.mutate({ id: integration!.id, enabled: !enabled })}>
                          {enabled ? t("integrations.disable") : t("integrations.enable")}
                        </button>
                        <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }}
                          onClick={() => handleDisconnect(integration!)}>
                          {t("integrations.disconnect")}
                        </button>
                        <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => setSelectedIntegration(selectedIntegration === integration!.id ? null : integration!.id)}>
                          {selectedIntegration === integration!.id ? t("integrations.hide_events") : t("integrations.view_events")}
                        </button>
                      </>
                    )}
                  </div>

                  {connected && MARKETPLACE_PROVIDERS.includes(provider.type) && (
                    <MarketplaceOrdersSection provider={provider.type} siteId={siteId} />
                  )}

                  {selectedIntegration === integration?.id && (
                    <div style={{ borderTop: "1px solid var(--border)", margin: "0 22px 16px" }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)", padding: "10px 0 6px" }}>
                        {t("integrations.event_log")}
                      </div>
                      <EventLogTable integrationId={integration.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {configProvider && (
        <ConfigModal
          provider={configProvider}
          integration={configIntegration}
          onClose={() => { setConfigProvider(null); setConfigIntegration(null); }}
        />
      )}
    </div>
  );
}

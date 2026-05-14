import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchIntegrations, createIntegration, updateIntegration,
  deleteIntegration, testIntegration, fetchWebhookEvents,
  getActiveSiteId,
} from "@/lib/api";
import type { Integration, IntegrationType } from "shared";

export const Route = createFileRoute("/integrations")({ component: IntegrationsPage });

const PROVIDERS: {
  type: IntegrationType;
  name: string;
  icon: string;
  description: string;
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[];
}[] = [
  {
    type: "mailchimp",
    name: "Mailchimp",
    icon: "M",
    description: "Sync subscriber data and track email engagement",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "your-mailchimp-api-key", secret: true },
      { key: "dc", label: "Server Prefix", placeholder: "us1" },
    ],
  },
  {
    type: "convertkit",
    name: "ConvertKit",
    icon: "C",
    description: "Connect your ConvertKit audience data",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "your-convertkit-api-key", secret: true },
    ],
  },
  {
    type: "kit",
    name: "Kit",
    icon: "K",
    description: "Sync with Kit (formerly ConvertKit) v3 API",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "your-kit-api-key", secret: true },
    ],
  },
  {
    type: "beehiiv",
    name: "Beehiiv",
    icon: "B",
    description: "Track newsletter subscriber activity",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "your-beehiiv-api-key", secret: true },
      { key: "publication_id", label: "Publication ID", placeholder: "pub_..." },
    ],
  },
  {
    type: "meta_ads",
    name: "Meta Ads",
    icon: "F",
    description: "Import ad performance and conversion data",
    fields: [
      { key: "access_token", label: "Access Token", placeholder: "your-meta-access-token", secret: true },
      { key: "pixel_id", label: "Pixel ID", placeholder: "123456789" },
    ],
  },
  {
    type: "google_ads",
    name: "Google Ads",
    icon: "G",
    description: "Link Google Ads campaign data",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "your-client-id" },
      { key: "client_secret", label: "Client Secret", placeholder: "your-client-secret", secret: true },
      { key: "refresh_token", label: "Refresh Token", placeholder: "your-refresh-token", secret: true },
      { key: "customer_id", label: "Customer ID", placeholder: "123-456-7890" },
    ],
  },
];

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
    mutationFn: () => createIntegration({ site_id: siteId, type: provider.type, name, config: form }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["integrations"] }); onClose(); },
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
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{isEdit ? "Update configuration" : "Setup integration"}</div>
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
                placeholder={isEdit ? "Leave empty to keep current" : field.placeholder}
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
                {updateMut.isPending ? "Saving..." : "Save Changes"}
              </button>
            ) : (
              <button className="btn-accent" onClick={() => createMut.mutate()} disabled={createMut.isPending} style={{ opacity: createMut.isPending ? 0.6 : 1 }}>
                {createMut.isPending ? "Connecting..." : "Connect"}
              </button>
            )}
            <button className="btn-pill" onClick={handleTest} disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventLogTable({ integrationId }: { integrationId: string }) {
  const { data: events, isLoading } = useQuery({
    queryKey: ["webhook-events", integrationId],
    queryFn: () => fetchWebhookEvents(integrationId),
    enabled: !!integrationId,
  });

  if (isLoading) return <div style={{ padding: 16, textAlign: "center" }}><div className="spinner" /></div>;

  const rows = events ?? [];
  if (rows.length === 0) {
    return <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No events yet</div>;
  }

  return (
    <div className="scroll-x">
      <table className="data-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Direction</th>
            <th>Status</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{e.event_type}</td>
              <td>{e.direction}</td>
              <td>
                <span style={{
                  fontFamily: "var(--mono)", fontSize: 10, padding: "2px 8px", borderRadius: 100,
                  background: e.status === "processed" ? "var(--green-dim)" : e.status === "failed" ? "var(--crit-dim)" : "var(--accent-dim)",
                  color: e.status === "processed" ? "var(--green)" : e.status === "failed" ? "var(--crit)" : "var(--accent)",
                }}>
                  {e.status}
                </span>
              </td>
              <td style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)" }}>
                {new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateIntegration(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });

  if (!siteId) {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <p>Select a site from the header</p>
      </div>
    );
  }

  const integrationMap = new Map<string, Integration>(
    (integrations ?? []).map((i) => [i.type, i])
  );

  const handleConfigure = (provider: typeof PROVIDERS[number]) => {
    const existing = integrationMap.get(provider.type);
    setConfigProvider(provider);
    setConfigIntegration(existing ?? null);
  };

  const handleDisconnect = (integration: Integration) => {
    if (!confirm(`Disconnect ${integration.name}?`)) return;
    deleteMut.mutate(integration.id);
    if (selectedIntegration === integration.id) setSelectedIntegration(null);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="overview-scroll">
        <div className="overview-header">
          <h1 className="overview-title">Integrations</h1>
          <p className="overview-sub">Connect your marketing tools to sync visitor and conversion data</p>
        </div>

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
                          {enabled ? "Connected" : "Disabled"}
                        </span>
                      )}
                    </div>
                  </div>

                  {connected && integration!.last_sync && (
                    <div style={{ padding: "8px 22px 0", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text4)" }}>
                      Last sync: {new Date(integration!.last_sync!).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}

                  <div style={{ padding: "16px 22px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
                      onClick={() => handleConfigure(provider)}>
                      {connected ? "Configure" : "Connect"}
                    </button>
                    {connected && (
                      <>
                        <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => toggleMut.mutate({ id: integration!.id, enabled: !enabled })}>
                          {enabled ? "Disable" : "Enable"}
                        </button>
                        <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }}
                          onClick={() => handleDisconnect(integration!)}>
                          Disconnect
                        </button>
                        <button className="btn-pill" style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => setSelectedIntegration(selectedIntegration === integration!.id ? null : integration!.id)}>
                          {selectedIntegration === integration!.id ? "Hide Events" : "View Events"}
                        </button>
                      </>
                    )}
                  </div>

                  {selectedIntegration === integration?.id && (
                    <div style={{ borderTop: "1px solid var(--border)", margin: "0 22px 16px" }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)", padding: "10px 0 6px" }}>
                        Event Log
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

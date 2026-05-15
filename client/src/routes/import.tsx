import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { importPolarOrders, importOneDollarStats, getActiveSiteId, fetchSites } from "@/lib/api";
import { toast } from "@/components/toast";

export const Route = createFileRoute("/import")({ component: ImportPage });

function ImportPage() {
  const navigate = useNavigate();
  const siteId = getActiveSiteId() ?? "";
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [selectedSite, setSelectedSite] = useState(siteId);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <button onClick={() => navigate({ to: "/site/$siteId", params: { siteId: selectedSite } })} style={{
          background: "none", border: "none", cursor: "pointer", color: "var(--text3)",
          fontSize: 18, padding: 0, display: "flex", alignItems: "center",
        }} title="Back to dashboard">
          ←
        </button>
        <h1 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 28, color: "var(--text)", margin: 0 }}>
          Import Data
        </h1>
      </div>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 24 }}>
        Import historical analytics and payment data from external providers.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>Import to site</label>
        <select value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)} style={{
          width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
          background: "var(--bg2)", color: "var(--text)", fontSize: 13, fontFamily: "var(--sans)",
        }}>
          {sites?.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.domain})</option>)}
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PolarImportCard siteId={selectedSite} />
        <OneDollarStatsImportCard siteId={selectedSite} />
      </div>
    </div>
  );
}

function PolarImportCard({ siteId }: { siteId: string }) {
  const [polarToken, setPolarToken] = useState("");
  const [polarOrgId, setPolarOrgId] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: () => importPolarOrders(siteId, polarToken, polarOrgId || undefined),
    onSuccess: (data) => { setResult(data as any); setError(""); toast((data as any).imported > 0 ? `Imported ${(data as any).imported} Polar orders` : "No new orders found", (data as any).imported > 0 ? "success" : "info"); },
    onError: (err) => { setError(err.message); setResult(null); },
  });

  const inputStyle = {
    width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--bg3)", color: "var(--text)", fontSize: 13, fontFamily: "var(--mono)" as const, boxSizing: "border-box" as const,
  };

  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
          background: "#1a1a2e", color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: "var(--mono)",
        }}>P</div>
        <div>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text)" }}>Polar</div>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>Import all paid orders with customer details &amp; country</div>
        </div>
      </div>

      <div style={{ background: "var(--bg3)", borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>How to create a Polar Organization Access Token</div>
        <ol style={{ margin: "0 0 0 0", paddingLeft: 18, color: "var(--text3)" }}>
          <li>Go to <a href="https://polar.sh" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>polar.sh</a>, click <strong>Settings</strong> on the left sidebar, then <strong>General</strong></li>
          <li>Scroll to bottom and click <strong>New Token</strong> in the Developer section</li>
          <li>Choose <strong>No expiration</strong></li>
          <li>Select permissions:{" "}
            <code style={{ fontFamily: "var(--mono)", background: "var(--bg2)", padding: "1px 4px", borderRadius: 3 }}>orders:read</code>,{" "}
            <code style={{ fontFamily: "var(--mono)", background: "var(--bg2)", padding: "1px 4px", borderRadius: 3 }}>subscriptions:read</code>,{" "}
            <code style={{ fontFamily: "var(--mono)", background: "var(--bg2)", padding: "1px 4px", borderRadius: 3 }}>organizations:read</code>
          </li>
          <li>Copy the token and paste it below</li>
        </ol>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>Polar Organization ID</label>
        <input type="text" value={polarOrgId} onChange={(e) => setPolarOrgId(e.target.value)} placeholder="e.g. a1b2c3d4-e5f6-..." style={inputStyle} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>Polar Access Token</label>
        <input type="password" value={polarToken} onChange={(e) => setPolarToken(e.target.value)} placeholder="polar_oat_..." style={inputStyle} />
      </div>

      <button onClick={() => mut.mutate()} disabled={mut.isPending || !siteId || !polarToken || !polarOrgId} style={{
        padding: "10px 20px", borderRadius: 8, border: "none", cursor: mut.isPending ? "wait" : "pointer",
        background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, fontFamily: "var(--sans)",
        opacity: mut.isPending || !siteId || !polarToken || !polarOrgId ? 0.6 : 1,
      }}>
        {mut.isPending ? "Importing..." : "Import Polar Orders"}
      </button>

      {result && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--green-dim)", fontSize: 12, color: "var(--green)" }}>
          Imported {result.imported} orders, skipped {result.skipped} (already imported or unpaid)
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#fef2f2", fontSize: 12, color: "#dc2626" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function OneDollarStatsImportCard({ siteId }: { siteId: string }) {
  const [apiKey, setApiKey] = useState("");
  const [odsDomain, setOdsDomain] = useState("");
  const [result, setResult] = useState<{ imported: number; note: string } | null>(null);
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: () => importOneDollarStats(siteId, apiKey, odsDomain),
    onSuccess: (data) => { setResult(data as any); setError(""); toast((data as any).imported > 0 ? `Imported ${(data as any).imported} events from OneDollarStats` : "No new data found", (data as any).imported > 0 ? "success" : "info"); },
    onError: (err) => { setError(err.message); setResult(null); },
  });

  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
          background: "#f0fdf4", color: "#16a34a", fontWeight: 700, fontSize: 14, fontFamily: "var(--mono)",
        }}>$</div>
        <div>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text)" }}>OneDollarStats</div>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>Import historical visitors, pages, countries, and sources</div>
        </div>
      </div>

      <div style={{ background: "var(--bg3)", borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>How to get your API key</div>
        <ol style={{ margin: 0, paddingLeft: 18, color: "var(--text3)" }}>
          <li>Log in to your <a href="https://onedollarstats.com" target="_blank" style={{ color: "var(--accent)" }}>OneDollarStats</a> dashboard</li>
          <li>Open your account settings (top-right corner)</li>
          <li>Go to <strong>API Keys</strong> and click <strong>Create API Key</strong></li>
          <li>Name it and save the key securely</li>
        </ol>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>API Key</label>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="x-api-key value" style={{
          width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
          background: "var(--bg3)", color: "var(--text)", fontSize: 13, fontFamily: "var(--mono)", boxSizing: "border-box",
        }} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>Site Domain (as registered in OneDollarStats)</label>
        <input type="text" value={odsDomain} onChange={(e) => setOdsDomain(e.target.value)} placeholder="yourdomain.com" style={{
          width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
          background: "var(--bg3)", color: "var(--text)", fontSize: 13, fontFamily: "var(--mono)", boxSizing: "border-box",
        }} />
      </div>

      <button onClick={() => mut.mutate()} disabled={mut.isPending || !siteId || !apiKey || !odsDomain} style={{
        padding: "10px 20px", borderRadius: 8, border: "none", cursor: mut.isPending ? "wait" : "pointer",
        background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, fontFamily: "var(--sans)",
        opacity: mut.isPending || !siteId || !apiKey || !odsDomain ? 0.6 : 1,
      }}>
        {mut.isPending ? "Importing..." : "Import from OneDollarStats"}
      </button>

      {result && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--green-dim)", fontSize: 12, color: "var(--green)" }}>
          Created {result.imported} events. {result.note}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#fef2f2", fontSize: 12, color: "#dc2626" }}>
          {error}
        </div>
      )}
    </div>
  );
}

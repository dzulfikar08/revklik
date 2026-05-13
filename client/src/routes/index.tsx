import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSites, createSite, setActiveSiteId, deleteSite } from "@/lib/api";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useState } from "react";

export const Route = createFileRoute("/")({ component: OverviewPage });

function Sparkline({ data, id }: { data: number[]; id: string }) {
  if (data.length < 2 || data.every((v) => v === 0)) return null;
  const chartData = data.map((v) => ({ v }));
  return (
    <div style={{ marginTop: 12, height: 48 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke="#22c55e" strokeWidth={1.5} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function OverviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: sites, isLoading } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [newDomain, setNewDomain] = useState("");
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState("");

  const handleAdd = async () => {
    const domain = newDomain.trim().toLowerCase();
    const name = newName.trim();
    if (!domain || !name) return;
    if (sites?.some((s) => s.domain === domain)) { setAddError("Site already added"); return; }
    try {
      const site = await createSite({ name, domain });
      setActiveSiteId(site.id);
      setNewDomain(""); setNewName(""); setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add site");
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    await deleteSite(id);
    queryClient.invalidateQueries({ queryKey: ["sites"] });
  };

  const hasNoSites = !sites || sites.length === 0;

  return (
    <div className="site-list-sub" style={{ flex: 1, padding: 24, overflow: "auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="site-list-h1" style={{ fontSize: 20, fontWeight: 700, color: "var(--fg)", margin: 0 }}>Your Sites</h1>
        <p className="site-list-sub" style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          Add your site domains to view analytics
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!showAdd ? (
              <button onClick={() => setShowAdd(true)} style={{
                padding: "10px 18px", borderRadius: 6, border: "none", background: "var(--cyan)",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}>
                + Add Site
              </button>
            ) : (
              <>
                <input value={newName} onChange={(e) => { setNewName(e.target.value); setAddError(""); }} placeholder="Site name" style={{ flex: "1 1 140px", minWidth: 120, padding: "10px 12px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }} />
                <input value={newDomain} onChange={(e) => { setNewDomain(e.target.value); setAddError(""); }} onKeyDown={(e) => e.key === "Enter" && handleAdd()} placeholder="example.com" style={{ flex: "1 1 180px", minWidth: 160, padding: "10px 12px", fontSize: 13 }} />
                <button onClick={handleAdd} disabled={!newDomain.trim() || !newName.trim()} style={{ padding: "10px 18px", borderRadius: 6, border: "none", background: "var(--cyan)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: !newDomain.trim() || !newName.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}>Add</button>
                <button onClick={() => { setShowAdd(false); setNewDomain(""); setNewName(""); setAddError(""); }} style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13 }}>Cancel</button>
              </>
            )}
          </div>
          {addError && <span style={{ fontSize: 11, color: "var(--crit)" }}>{addError}</span>}
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
          <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--cyan)", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        </div>
      ) : hasNoSites ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 8, color: "var(--muted)", fontSize: 13, padding: 40,
        }}>
          <span style={{ fontSize: 32 }}>📊</span>
          No sites yet. Add your first site domain above.
        </div>
      ) : (
        <div className="site-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 16,
        }}>
          {sites.map((site) => (
            <div key={site.id} style={{
              background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
              overflow: "hidden", transition: "border-color 0.15s, box-shadow 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--cyan)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--cyan)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  onClick={() => { setActiveSiteId(site.id); navigate({ to: "/site" }); }}
                  style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8 }}
                >
                  {site.name}
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>→</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(site.id, site.name); }}
                  title="Remove site"
                  style={{ fontSize: 14, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 4, lineHeight: 1 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--crit)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
                >✕</button>
              </div>
              <button
                onClick={() => { setActiveSiteId(site.id); navigate({ to: "/site" }); }}
                style={{ padding: "14px 24px 20px", cursor: "pointer", background: "none", border: "none", width: "100%", textAlign: "left", color: "var(--fg)" }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, marginBottom: 4 }}>Visitors</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>{site.visitors.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, marginBottom: 4 }}>Views</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>{site.pageviews.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, marginBottom: 4 }}>Revenue</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>${site.revenue}</div>
                  </div>
                </div>
                <Sparkline data={site.sparkline} id={site.id} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Last 7 days</div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

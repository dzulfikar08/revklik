import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSites, createSite, deleteSite } from "@/lib/api";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useState } from "react";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/")({ component: OverviewPage });

function Sparkline({ data, color }: { data: number[]; color?: string }) {
  if (data.length < 2 || data.every((v) => v === 0)) return null;
  const chartData = data.map((v) => ({ v }));
  const stroke = color || "var(--accent)";
  return (
    <div className="site-card-spark">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.2} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5} fill="url(#sparkGrad)" dot={false} isAnimationActive={false} />
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
      await createSite({ name, domain });
      setNewDomain(""); setNewName(""); setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add site");
    }
  };

  const handleRemove = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!confirm(`Delete ${name}?`)) return;
    await deleteSite(id);
    queryClient.invalidateQueries({ queryKey: ["sites"] });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="overview-scroll">
        <div className="overview-header">
          <h1 className="overview-title">{t("sites.title")}</h1>
          <p className="overview-sub">{sites?.length ?? 0} {t("sites.tracked")}</p>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
            <div className="spinner" />
          </div>
        ) : (
          <div className="site-cards-grid">
            {sites?.map((site, i) => (
              <div key={site.id} className="site-card" style={{ animationDelay: `${i * 80}ms` }}
                onClick={() => { navigate({ to: "/site/$siteId", params: { siteId: site.id } }); }}
              >
                <div className="site-card-header">
                  <div>
                    <div className="site-card-name">{site.name}</div>
                    <div className="site-card-domain">{site.domain}</div>
                  </div>
                  <button
                    onClick={(e) => handleRemove(e, site.id, site.name)}
                    style={{ color: "var(--text4)", fontSize: 14, padding: "4px 8px", borderRadius: 6, transition: "color 0.15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--crit)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text4)")}
                  >✕</button>
                </div>
                <div className="site-card-metrics">
                  <div>
                    <div className="site-card-metric-value">{site.visitors.toLocaleString()}</div>
                    <div className="site-card-metric-label">Visitors</div>
                  </div>
                  <div>
                    <div className="site-card-metric-value">{site.pageviews.toLocaleString()}</div>
                    <div className="site-card-metric-label">Views</div>
                  </div>
                  <div>
                    <div className="site-card-metric-value">${site.revenue}</div>
                    <div className="site-card-metric-label">Revenue</div>
                  </div>
                </div>
                <Sparkline data={site.sparkline} />
                <div className="site-card-footer">
                  <span>{t("sites.last_7d")}</span>
                  <span style={{ color: "var(--accent)" }}>{t("sites.view_details")}</span>
                </div>
              </div>
            ))}

            {!showAdd ? (
              <div className="add-site-card" onClick={() => setShowAdd(true)}>
                <span style={{ fontSize: 24, fontWeight: 300 }}>+</span>
                <span>{t("sites.add")}</span>
              </div>
            ) : (
              <div style={{
                background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 16,
                padding: 24, display: "flex", flexDirection: "column", gap: 12,
                animation: "fadeUp 0.3s ease both",
              }}>
                <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text)" }}>{t("sites.add_new")}</div>
                <input value={newName} onChange={(e) => { setNewName(e.target.value); setAddError(""); }} placeholder={t("sites.name_placeholder")} style={{ width: "100%" }} />
                <input value={newDomain} onChange={(e) => { setNewDomain(e.target.value); setAddError(""); }} onKeyDown={(e) => e.key === "Enter" && handleAdd()} placeholder="example.com" style={{ width: "100%" }} />
                {addError && <div style={{ fontSize: 12, color: "var(--crit)" }}>{addError}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-accent" onClick={handleAdd} disabled={!newDomain.trim() || !newName.trim()}
                    style={{ opacity: !newDomain.trim() || !newName.trim() ? 0.4 : 1 }}>
                    {t("sites.add")}
                  </button>
                  <button className="btn-pill" onClick={() => { setShowAdd(false); setNewDomain(""); setNewName(""); setAddError(""); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

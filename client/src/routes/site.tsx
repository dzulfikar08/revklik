import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchDashboard, getActiveSiteId, updateVisitor } from "@/lib/api";
import type { VisitorJourney } from "shared";

export const Route = createFileRoute("/site")({ component: SiteDetailPage });

/* ── Metric Card (onedollarstats style) ── */

function MetricCard({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="metric-card" style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6,
      transition: "border-color 0.15s", minWidth: 0,
    }}>
      <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
        {label}
      </span>
      {loading ? (
        <div style={{ width: 60, height: 24, borderRadius: 4, background: "var(--border)", animation: "pulse 1.5s infinite" }} />
      ) : (
        <span className="num" style={{ fontSize: 26, fontWeight: 700, color: "var(--fg)" }}>
          {value}
        </span>
      )}
    </div>
  );
}

/* ── Chart Card (onedollarstats style) ── */

function ChartCard({ data, loading }: { data: { date: string; pageviews: number; visitors: number }[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="chart-card" style={{
        background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
        padding: 20, height: 280, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading chart...</div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="chart-card" style={{
        background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
        padding: 20, height: 280, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>No data for this period</div>
      </div>
    );
  }

  const chartData = data.map((row) => {
    const d = row.date;
    return { ...row, label: d.length > 10 ? d.substring(5, 16) : d.substring(5) };
  });

  return (
    <div className="chart-card" style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "16px 16px 8px",
    }}>
      <div className="chart-label" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, marginBottom: 12 }}>
        Pageviews & Visitors over time
      </div>
      <div className="chart-container" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="grad-pageviews" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-visitors" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={35} />
            <Tooltip
              contentStyle={{
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
                fontSize: 11, color: "var(--fg)", boxShadow: "0 4px 12px rgba(0,0,0,.3)",
                padding: "6px 10px",
              }}
              labelStyle={{ color: "var(--muted)", marginBottom: 2, fontSize: 11 }}
            />
            <Area type="monotone" dataKey="pageviews" stroke="#22c55e" strokeWidth={2} fill="url(#grad-pageviews)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="visitors" stroke="#3b82f6" strokeWidth={2} fill="url(#grad-visitors)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Data Table (onedollarstats style) ── */

function DataTable({ title, rows, columns }: {
  title: string;
  rows: Record<string, string | number>[];
  columns: { key: string; label: string; align?: "left" | "right"; mono?: boolean }[];
}) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{
        padding: "14px 20px 10px", fontSize: 11, color: "var(--muted)",
        textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600,
      }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>No data</div>
      ) : (
        <div className="scroll-x">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} style={{
                    textAlign: col.align || "left", padding: "8px 20px", fontSize: 11, color: "var(--muted)",
                    borderBottom: "1px solid var(--border)", fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: ".04em", whiteSpace: "nowrap",
                  }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ transition: "background 0.1s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{
                      padding: "10px 20px", borderBottom: "1px solid var(--border)",
                      textAlign: col.align || "left",
                      color: "var(--fg)", fontWeight: 500, whiteSpace: "nowrap",
                      fontFamily: col.mono ? "JetBrains Mono, monospace" : "inherit",
                      fontSize: col.mono ? 12 : 13,
                    }}>
                      {row[col.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Journey Row ── */

function JourneyRow({ journey, selected, onClick }: { journey: VisitorJourney; selected: boolean; onClick: () => void }) {
  const [open, setOpen] = useState(false);
  const name = journey.visitor_name || journey.visitor_email || `visitor_${journey.visitor_id.slice(0, 6)}`;
  const hasRevenue = journey.total_revenue > 0;

  return (
    <div style={{
      background: selected ? "var(--hover-overlay)" : "transparent",
      border: `1px solid ${selected ? "var(--cyan)" : "var(--border)"}`,
      borderRadius: 8, transition: "border-color 0.1s",
    }}>
      <div
        onClick={() => { setOpen(!open); onClick(); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", cursor: "pointer" }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: hasRevenue ? "var(--ok)" : journey.is_identified ? "#a855f7" : "var(--border-light)",
        }} />
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {journey.country && <span style={{ fontSize: 10, color: "var(--muted)" }}>{journey.country}</span>}
        {journey.browser && <span style={{ fontSize: 10, color: "var(--muted)" }}>{journey.browser}</span>}
        {hasRevenue && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ok)" }}>${journey.total_revenue}</span>}
        <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "JetBrains Mono, monospace" }}>{new Date(journey.started_at).toLocaleDateString()}</span>
        <span style={{ fontSize: 10, color: "var(--muted)", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▸</span>
      </div>
      {open && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {journey.utm_source && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", color: "var(--text-dim)" }}>src: {journey.utm_source}</span>}
          {journey.device_type && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", color: "var(--text-dim)" }}>{journey.device_type}</span>}
          {journey.referrer && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", color: "var(--text-dim)" }}>via {new URL(journey.referrer).hostname}</span>}
          <div style={{ width: "100%", display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
            {journey.steps.map((step, i) => (
              <span key={i} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 4,
                fontFamily: "JetBrains Mono, monospace",
                background: step.event_type === "conversion" ? "rgba(34,197,94,0.15)" : step.event_type === "custom" ? "rgba(167,139,250,0.15)" : "var(--bg)",
                color: step.event_type === "conversion" ? "var(--ok)" : "var(--text-dim)",
                fontWeight: step.event_type === "conversion" ? 600 : 400,
              }}>
                {step.event_type === "pageview" ? step.path : step.event_type === "conversion" ? `${step.name} $${step.revenue}` : step.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Profile Panel (shows when a journey is selected) ── */

function ProfilePanel({ journey, onClose }: { journey: VisitorJourney | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("");
  const [, setSaved] = useState(false);

  if (!journey) return null;

  const handleEdit = () => { setName(journey.visitor_name ?? ""); setEmail(journey.visitor_email ?? ""); setTags(""); setEditing(true); setSaved(false); };
  const handleSave = async () => {
    await updateVisitor(journey.visitor_id, { name: name || undefined, email: email || undefined, tags });
    setEditing(false); setSaved(true);
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 280,
      background: "var(--card)", borderLeft: "1px solid var(--border)",
      padding: 20, overflowY: "auto", zIndex: 100,
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)", textTransform: "uppercase", letterSpacing: ".05em" }}>Visitor Profile</span>
        <button onClick={onClose} style={{ fontSize: 14, color: "var(--muted)", cursor: "pointer", padding: "2px 4px" }}>✕</button>
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ fontSize: 12, padding: "8px 10px" }} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ fontSize: 12, padding: "8px 10px" }} />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma separated)" style={{ fontSize: 12, padding: "8px 10px" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleSave} style={{ padding: "6px 12px", borderRadius: 6, background: "var(--cyan)", color: "#fff", fontSize: 12, fontWeight: 600 }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--muted)", fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700,
              background: journey.is_identified ? "rgba(34,197,94,0.15)" : "var(--border)",
              color: journey.is_identified ? "var(--ok)" : "var(--muted)",
            }}>
              {(journey.visitor_name || journey.visitor_email || "?")[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{journey.visitor_name || "Unknown"}</p>
              <p className="mono" style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{journey.visitor_email || journey.visitor_id.slice(0, 16)}</p>
            </div>
          </div>
          <button onClick={handleEdit} style={{ fontSize: 11, color: "var(--cyan)", textAlign: "left", padding: 0 }}>Edit profile</button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: "var(--text-dim)" }}>
            {journey.country && <span>🌍 {journey.country}</span>}
            {journey.city && <span>📍 {journey.city}</span>}
            {journey.device_type && <span>💻 {journey.device_type}</span>}
            {journey.browser && <span>🌐 {journey.browser}</span>}
            {journey.os && <span>🖥 {journey.os}</span>}
            {journey.utm_source && <span>🔗 {journey.utm_source}</span>}
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, paddingTop: 14,
            borderTop: "1px solid var(--border)", marginTop: 4,
          }}>
            <div style={{ textAlign: "center" }}><p className="num" style={{ fontSize: 18, fontWeight: 700 }}>{journey.steps.length}</p><p style={{ fontSize: 10, color: "var(--muted)" }}>steps</p></div>
            <div style={{ textAlign: "center" }}><p className="num" style={{ fontSize: 18, fontWeight: 700 }}>${journey.total_revenue}</p><p style={{ fontSize: 10, color: "var(--muted)" }}>revenue</p></div>
            <div style={{ textAlign: "center" }}><p className="num" style={{ fontSize: 18, fontWeight: 700 }}>{journey.utm_source || "direct"}</p><p style={{ fontSize: 10, color: "var(--muted)" }}>source</p></div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Empty State ── */

function EmptyState({ siteId }: { siteId: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script defer src="${window.location.origin}/klikapa.js"></script>
<script>
  window.klikapa_site_id = "${siteId}";
  window.klikapa_endpoint = "${window.location.origin}/api/track";
</script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="main-content" style={{ flex: 1, overflow: "auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "60px 0", textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
        <span style={{ fontSize: 32, color: "var(--muted)" }}>📡</span>
        <p style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)" }}>You have no events</p>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: 440 }}>
          Add the analytics script to your website to start tracking
        </p>
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
          padding: "16px 20px", fontFamily: "JetBrains Mono, monospace", fontSize: 12,
          textAlign: "left", width: "100%", color: "var(--text-dim)", lineHeight: 1.8,
        }}>
          &lt;script defer src="{window.location.origin}/klikapa.js"&gt;&lt;/script&gt;<br />
          &lt;script&gt;<br />
          &nbsp;&nbsp;window.klikapa_site_id = "{siteId}";<br />
          &nbsp;&nbsp;window.klikapa_endpoint = "{window.location.origin}/api/track";<br />
          &lt;/script&gt;
        </div>
        <button onClick={handleCopy} style={{
          padding: "8px 18px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--card)", color: "var(--fg)", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>
          {copied ? "✓ Copied!" : "Copy script"}
        </button>
        <div style={{ marginTop: 24, textAlign: "left", fontSize: 12, color: "var(--muted)", lineHeight: 1.8, maxWidth: 440 }}>
          <p style={{ fontWeight: 600, color: "var(--text-dim)", marginBottom: 4 }}>Not seeing events?</p>
          <p>1. Check that the script is loaded correctly. Open your site in the browser, right-click anywhere and select <strong>Inspect</strong>. Go to the Network tab, refresh the page, and look for klikapa.js.</p>
          <p style={{ marginTop: 6 }}>2. Make sure the site_id matches your dashboard site.</p>
          <p style={{ marginTop: 6 }}>3. Are you running the site locally? Analytics from localhost may be blocked by browser settings.</p>
        </div>
      </div>
    </div>
  );
}

/* ── Site Detail Page ── */

function SiteDetailPage() {
  const siteId = getActiveSiteId() ?? "";
  const [range, setRange] = useState("7d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<VisitorJourney | null>(null);

  const effectiveRange = showCustom && customStart && customEnd ? `${customStart},${customEnd}` : range;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", siteId, effectiveRange],
    queryFn: () => fetchDashboard(siteId, showCustom && customStart && customEnd ? undefined : range, showCustom ? customStart : undefined, showCustom ? customEnd : undefined),
    enabled: !!siteId,
    refetchInterval: 15000,
  });

  if (!siteId) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--muted)", fontSize: 13, padding: 40, textAlign: "center" }}>
        <span style={{ fontSize: 32 }}>📊</span>
        No site yet. Add your first site from the header.
      </div>
    );
  }

  const hasNoData = !isLoading && data && data.stats.pageviews === 0;
  const stats = data?.stats;
  const journeys = data?.journeys ?? [];
  const topPages = data?.topPages ?? [];
  const sources = data?.sources ?? [];
  const timeseries = data?.timeseries ?? [];

  const presetRanges = [
    { key: "24h", label: "24h" },
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Date range bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "10px 24px",
        borderBottom: "1px solid var(--border)", background: "var(--card)", flexShrink: 0,
        flexWrap: "wrap",
      }}>
        {presetRanges.map((r) => (
          <button key={r.key} onClick={() => { setRange(r.key); setShowCustom(false); }} style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            borderRadius: 6, border: !showCustom && range === r.key ? "1px solid var(--cyan)" : "1px solid var(--border)",
            background: !showCustom && range === r.key ? "rgba(34,197,94,0.1)" : "transparent",
            color: !showCustom && range === r.key ? "var(--cyan)" : "var(--muted)",
            transition: "color 0.15s, border-color 0.15s, background 0.15s",
          }}>
            {r.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
        <button onClick={() => setShowCustom(!showCustom)} style={{
          padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
          borderRadius: 6, border: showCustom ? "1px solid var(--cyan)" : "1px solid var(--border)",
          background: showCustom ? "rgba(34,197,94,0.1)" : "transparent",
          color: showCustom ? "var(--cyan)" : "var(--muted)",
          transition: "color 0.15s, border-color 0.15s, background 0.15s",
        }}>
          Custom
        </button>
        {showCustom && (
          <>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              style={{ fontSize: 12, padding: "6px 10px" }}
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>→</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={{ fontSize: 12, padding: "6px 10px" }}
            />
            {customStart && customEnd && (
              <button onClick={() => setShowCustom(true)} style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                borderRadius: 6, border: "1px solid var(--cyan)", background: "var(--cyan)",
                color: "#fff",
              }}>
                Apply
              </button>
            )}
          </>
        )}
      </div>

      {isLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--cyan)", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        </div>
      ) : hasNoData ? (
        <EmptyState siteId={siteId} />
      ) : (
        <div className="main-content" style={{ flex: 1, overflow: "auto", padding: "20px 24px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Metric Cards */}
          <div className="metric-grid" style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, overflow: "hidden",
          }}>
            <MetricCard label="Views" value={stats?.pageviews?.toLocaleString() ?? "0"} />
            <MetricCard label="Visitors" value={stats?.visitors?.toLocaleString() ?? "0"} />
            <MetricCard label="Sessions" value={stats?.sessions?.toLocaleString() ?? "0"} />
            <MetricCard label="Bounce Rate" value={`${stats?.bounceRate ?? 0}%`} />
            <MetricCard label="Conversions" value={stats?.conversions?.toLocaleString() ?? "0"} />
            <MetricCard label="Revenue" value={`$${stats?.revenue ?? 0}`} />
          </div>

          {/* Chart */}
          <ChartCard data={timeseries} loading={isLoading} />

          {/* Two column: Top Pages + Sources */}
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <DataTable
              title="Top Pages"
              rows={topPages.map((p) => ({ path: p.path, views: p.pageviews.toLocaleString(), visitors: p.visitors.toLocaleString() }))}
              columns={[
                { key: "path", label: "Page" },
                { key: "views", label: "Views", align: "right", mono: true },
                { key: "visitors", label: "Visitors", align: "right", mono: true },
              ]}
            />
            <DataTable
              title="Traffic Sources"
              rows={sources.map((s) => ({ source: s.source, pct: `${s.percentage}%` }))}
              columns={[
                { key: "source", label: "Source" },
                { key: "pct", label: "Share", align: "right", mono: true },
              ]}
            />
          </div>

          {/* Journeys */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{
              padding: "14px 20px 10px", fontSize: 11, color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600,
              display: "flex", justifyContent: "space-between",
            }}>
              <span>Recent Journeys ({journeys.length})</span>
            </div>
            {journeys.length === 0 ? (
              <div style={{ padding: 20, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>No journeys yet</div>
            ) : (
              <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                {journeys.map((j) => (
                  <JourneyRow key={j.session_id} journey={j} selected={selectedJourney?.session_id === j.session_id} onClick={() => setSelectedJourney(j)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Profile side panel */}
      {selectedJourney && <ProfilePanel journey={selectedJourney} onClose={() => setSelectedJourney(null)} />}
    </div>
  );
}

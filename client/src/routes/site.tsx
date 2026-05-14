import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchDashboard, fetchFunnel, fetchGeo, getActiveSiteId, updateVisitor, connectSSE, exportData } from "@/lib/api";
import type { VisitorJourney, FunnelStep } from "shared";
import { Globe, geoToMarkers } from "@/components/globe";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { EventCalculator } from "@/components/event-calculator";
import { t } from "@/lib/i18n";
import { Capacitor } from "@capacitor/core";

export const Route = createFileRoute("/site")({ component: SiteDetailPage });

function MetricCard({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      {loading ? (
        <div style={{ width: 50, height: 22, borderRadius: 4, background: "var(--border)", animation: "pulse 1.5s infinite" }} />
      ) : (
        <span className="metric-value">{value}</span>
      )}
    </div>
  );
}

function ChartCard({ data, loading }: { data: { date: string; pageviews: number; visitors: number }[]; loading: boolean }) {
  if (loading) {
    return <div className="chart-wrap" style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>;
  }
  if (!data || data.length === 0) {
    return <div className="chart-wrap" style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 13 }}>{t("chart.no_data")}</div>;
  }
  const chartData = data.map((row) => ({ ...row, label: row.date.length > 10 ? row.date.substring(5, 16) : row.date.substring(5) }));
  return (
    <div className="chart-wrap">
      <div className="chart-label">{t("chart.pageviews_visitors")}</div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="gpv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gvs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--info)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text3)", fontFamily: "var(--mono)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "var(--text3)", fontFamily: "var(--mono)" }} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, fontSize: 11, color: "var(--text)", boxShadow: "0 8px 24px rgba(0,0,0,.4)", padding: "6px 10px" }} labelStyle={{ color: "var(--text3)", marginBottom: 2, fontSize: 11 }} />
            <Area type="monotone" dataKey="pageviews" stroke="var(--accent)" strokeWidth={2} fill="url(#gpv)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="visitors" stroke="var(--info)" strokeWidth={1.5} fill="url(#gvs)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DataTable({ title, rows, columns }: {
  title: string;
  rows: Record<string, string | number>[];
  columns: { key: string; label: string; align?: "left" | "right"; mono?: boolean }[];
}) {
  return (
    <div className="data-table-card">
      <div className="data-table-title">{title}</div>
      {rows.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>{t("common.no_data")}</div>
      ) : (
        <div className="scroll-x">
          <table className="data-table">
            <thead><tr>{columns.map((col) => <th key={col.key} style={{ textAlign: col.align || "left" }}>{col.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>{columns.map((col) => <td key={col.key} style={{ textAlign: col.align || "left", fontFamily: col.mono ? "var(--mono)" : "inherit", fontSize: col.mono ? 12 : 13 }}>{row[col.key] ?? "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function sessionDuration(j: VisitorJourney): string {
  if (j.steps.length < 2) return "0s";
  const start = new Date(j.steps[0].timestamp).getTime();
  const end = new Date(j.steps[j.steps.length - 1].timestamp).getTime();
  const d = end - start;
  if (d < 60000) return `${Math.round(d / 1000)}s`;
  if (d < 3600000) return `${Math.round(d / 60000)}m ${Math.round((d % 60000) / 1000)}s`;
  return `${Math.round(d / 3600000)}h`;
}

function parseProps(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function StepIcon({ type }: { type: string }) {
  if (type === "pageview") return <span style={{ color: "var(--accent)", fontSize: 13 }}>◆</span>;
  if (type === "conversion") return <span style={{ color: "var(--green)", fontSize: 13 }}>★</span>;
  return <span style={{ color: "var(--text3)", fontSize: 13 }}>●</span>;
}

function StepLabel({ step }: { step: VisitorJourney["steps"][number] }) {
  const props = parseProps(step.props);
  if (step.event_type === "pageview") {
    return <span style={{ color: "var(--text)" }}>{step.path}</span>;
  }
  if (step.event_type === "custom" && step.name === "scroll") {
    const depth = props.depth ? `${props.depth}%` : "";
    const section = props.section ? props.section : "";
    return <span style={{ color: "var(--text2)" }}>Scrolled to {depth}{section ? ` — ${section}` : ""}</span>;
  }
  if (step.event_type === "custom" && step.name === "scroll_section") {
    const section = props.section ?? "section";
    const depth = props.depth ? ` (${props.depth}%)` : "";
    return <span style={{ color: "var(--text2)" }}>Read section: {section}{depth}</span>;
  }
  if (step.event_type === "custom" && step.name === "click") {
    const label = props.label ?? "unknown";
    const tag = props.tag ?? "";
    return <span style={{ color: "var(--text)" }}>Clicked <span style={{ color: "var(--accent)", fontWeight: 500 }}>"{label}"</span> <span style={{ color: "var(--text3)", fontSize: 11 }}>&lt;{tag}&gt;</span></span>;
  }
  if (step.event_type === "custom" && step.name === "heartbeat") {
    const secs = props.seconds ? `${props.seconds}s` : "";
    return <span style={{ color: "var(--text3)" }}>Active {secs}</span>;
  }
  if (step.event_type === "conversion") {
    return <span style={{ color: "var(--green)", fontWeight: 600 }}>Conversion: {step.name} {step.revenue ? `$${step.revenue}` : ""}</span>;
  }
  return <span style={{ color: "var(--text2)" }}>{step.name || step.event_type}</span>;
}

function JourneyTimeline({ journey }: { journey: VisitorJourney }) {
  const steps = journey.steps;
  return (
    <div className="journey-timeline">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1] : null;
        const gap = prev ? new Date(step.timestamp).getTime() - new Date(prev.timestamp).getTime() : 0;
        const showGap = gap > 5 * 60 * 1000;
        return (
          <div key={i}>
            {showGap && (
              <div className="timeline-gap">
                <span className="timeline-gap-line" />
                <span className="timeline-gap-label">{gap > 3600000 ? `${Math.round(gap / 3600000)}h gap` : `${Math.round(gap / 60000)}m gap`}</span>
                <span className="timeline-gap-line" />
              </div>
            )}
            <div className="timeline-row">
              <div className="timeline-left">
                <StepIcon type={step.event_type} />
                <span className="timeline-time">{formatTime(step.timestamp)}</span>
              </div>
              <div className="timeline-content">
                <StepLabel step={step} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JourneyCard({ journey, selected, onClick }: { journey: VisitorJourney; selected: boolean; onClick: () => void }) {
  const [open, setOpen] = useState(false);
  const name = journey.visitor_name || journey.visitor_email || `visitor_${journey.visitor_id.slice(0, 6)}`;
  const hasRevenue = journey.total_revenue > 0;
  const dateStr = new Date(journey.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const timeStr = formatTime(journey.started_at);

  return (
    <div className={`journey-card ${selected ? "selected" : ""}`}>
      <div className="journey-main" onClick={() => { setOpen(!open); onClick(); }}>
        <div className={`journey-dot ${hasRevenue ? "revenue" : journey.is_identified ? "identified" : ""}`} />
        <span className="journey-name">{name}</span>
        {journey.country && <span className="journey-meta">📍 {[journey.city, journey.region, journey.country].filter(Boolean).join(", ")}</span>}
        {journey.browser && <span className="journey-meta">{journey.browser}</span>}
        {journey.device_type && <span className="journey-meta">{journey.device_type}</span>}
        {journey.utm_source && <span className="journey-meta" style={{ color: "var(--accent)" }}>via {journey.utm_source}</span>}
        {hasRevenue && <span className="journey-revenue">${journey.total_revenue}</span>}
        <span className="journey-meta">{dateStr} {timeStr}</span>
        <span style={{ fontSize: 10, color: "var(--text3)", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0)", display: "inline-block" }}>▸</span>
      </div>
      {open && (
        <div className="journey-expanded">
          <div className="journey-context">
            {journey.referrer && <span className="journey-tag">ref: {journey.referrer}</span>}
            {journey.os && <span className="journey-tag">{journey.os}</span>}
            {(journey.city || journey.region) && <span className="journey-tag">{[journey.city, journey.region].filter(Boolean).join(", ")}</span>}
          </div>
          <JourneyTimeline journey={journey} />
        </div>
      )}
    </div>
  );
}

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
    <div className="profile-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)" }}>{t("profile.title")}</span>
        <button onClick={onClose} style={{ fontSize: 14, color: "var(--text3)", cursor: "pointer" }}>✕</button>
      </div>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma separated)" />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-accent" onClick={handleSave}>Save</button>
            <button className="btn-pill" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontFamily: "var(--serif)", fontStyle: "italic",
              background: journey.is_identified ? "var(--green-dim)" : "var(--bg3)",
              color: journey.is_identified ? "var(--green)" : "var(--text3)",
            }}>
              {(journey.visitor_name || journey.visitor_email || "?")[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{journey.visitor_name || "Unknown"}</p>
              <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{journey.visitor_email || journey.visitor_id.slice(0, 16)}</p>
            </div>
          </div>
          <button onClick={handleEdit} style={{ fontSize: 12, color: "var(--accent)", textAlign: "left", padding: 0, fontWeight: 600 }}>{t("profile.edit")}</button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, color: "var(--text2)" }}>
            {[journey.city, journey.region, journey.country].filter(Boolean).length > 0 && <span>{[journey.city, journey.region, journey.country].filter(Boolean).join(", ")}</span>}
            {journey.device_type && <span>{journey.device_type}</span>}
            {journey.browser && <span>{journey.browser}</span>}
            {journey.os && <span>{journey.os}</span>}
            {journey.utm_source && <span>{journey.utm_source}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, paddingTop: 16, borderTop: "1px solid var(--border)", marginTop: 4 }}>
            <div style={{ textAlign: "center" }}><p style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600 }}>{journey.steps.length}</p><p style={{ fontSize: 10, color: "var(--text3)" }}>steps</p></div>
            <div style={{ textAlign: "center" }}><p style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600 }}>${journey.total_revenue}</p><p style={{ fontSize: 10, color: "var(--text3)" }}>revenue</p></div>
            <div style={{ textAlign: "center" }}><p style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600 }}>{journey.utm_source || "direct"}</p><p style={{ fontSize: 10, color: "var(--text3)" }}>source</p></div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ siteId }: { siteId: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script defer data-site-id="${siteId}" src="${window.location.origin}/klikapa.js"></script>`;

  return (
    <div className="detail-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
      <Globe />
      <div style={{ textAlign: "center", marginTop: -80, maxWidth: 480 }}>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 28, color: "var(--text)", marginBottom: 8 }}>
          {t("sites.waiting")}
        </div>
        <p style={{ color: "var(--text3)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          {t("sites.script_hint")}
        </p>
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10,
          padding: "14px 18px", fontFamily: "var(--mono)", fontSize: 11,
          textAlign: "left", width: "100%", color: "var(--text2)", lineHeight: 1.8, wordBreak: "break-all",
          marginBottom: 16,
        }}>
          &lt;script defer data-site-id="{siteId}"<br />&nbsp;&nbsp;src="{window.location.origin}/klikapa.js"&gt;&lt;/script&gt;
        </div>
        <button className="btn-accent" onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? t("common.copied") : t("common.copy_script")}
        </button>
      </div>
    </div>
  );
}

function FunnelChart({ steps, totalVisitors, conversionRate }: { steps: FunnelStep[]; totalVisitors: number; conversionRate: number }) {
  if (steps.length === 0) {
    return (
      <div className="funnel-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <span className="funnel-title">LP Scroll Funnel</span>
          </div>
        </div>
        <div style={{ padding: "32px 0", color: "var(--text3)", fontSize: 13, textAlign: "center" }}>
          No scroll data yet — add <code style={{ fontFamily: "var(--mono)", fontSize: 11, background: "var(--bg3)", padding: "2px 6px", borderRadius: 4 }}>data-section</code> attributes to your page sections
        </div>
      </div>
    );
  }

  const maxVisitors = totalVisitors;

  return (
    <div className="funnel-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <span className="funnel-title">LP Scroll Funnel</span>
          <span className="funnel-subtitle">{steps.length} steps</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 600, color: "var(--green)" }}>{conversionRate}%</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Conversion</div>
        </div>
      </div>

      <div className="funnel-steps">
        {steps.map((step, i) => {
          const widthPct = maxVisitors > 0 ? Math.max(8, (step.visitors / maxVisitors) * 100) : 8;
          const colors = [
            ["var(--accent)", "rgba(212,136,42,.12)"],
            ["#e8943a", "rgba(232,148,58,.10)"],
            ["#d4882a", "rgba(212,136,42,.09)"],
            ["#c07824", "rgba(192,120,36,.08)"],
            ["#a86920", "rgba(168,105,32,.07)"],
            ["#905b1c", "rgba(144,91,28,.06)"],
            ["#784d18", "rgba(120,77,24,.05)"],
            ["#604014", "rgba(96,64,20,.04)"],
          ];
          const [barColor, bgColor] = colors[i % colors.length] ?? colors[7]!;

          return (
            <div key={step.section} className="funnel-step">
              <div className="funnel-step-top">
                <span className="funnel-step-name">{step.section}</span>
                <span className="funnel-step-visitors">{step.visitors.toLocaleString()} visitors</span>
              </div>
              <div className="funnel-bar-track" style={{ background: bgColor }}>
                <div className="funnel-bar-fill" style={{ width: `${widthPct}%`, background: barColor }} />
              </div>
              <div className="funnel-step-bottom">
                <span className="funnel-step-pct">{step.percentage}%</span>
                {i > 0 && step.dropoff > 0 && (
                  <span className="funnel-step-drop">-{step.dropoff}%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GlobeSummaryPanel({ journeys }: { journeys: VisitorJourney[] }) {
  const stats = useMemo(() => {
    const uniqueVisitors = new Set(journeys.map(j => j.visitor_id)).size;
    const byReferrer = Object.entries(
      journeys.reduce<Record<string, number>>((acc, j) => {
        const key = j.utm_source || j.referrer || "direct";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const byCountry = Object.entries(
      journeys.reduce<Record<string, number>>((acc, j) => {
        const key = j.country || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const byDevice = Object.entries(
      journeys.reduce<Record<string, number>>((acc, j) => {
        const key = j.device_type || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { uniqueVisitors, byReferrer, byCountry, byDevice };
  }, [journeys]);

  return (
    <div className="globe-summary-panel">
      <div className="globe-stat-card">
        <span className="globe-stat-label">{t("globe.live_visitors")}</span>
        <span className="globe-stat-value">{stats.uniqueVisitors}</span>
      </div>
      {stats.byReferrer.length > 0 && (
        <div className="globe-stat-group">
          <span className="globe-stat-group-title">Sources</span>
          {stats.byReferrer.map(([src, count]) => (
            <div key={src} className="globe-stat-row"><span>{src}</span><span className="globe-stat-num">{count}</span></div>
          ))}
        </div>
      )}
      {stats.byCountry.length > 0 && (
        <div className="globe-stat-group">
          <span className="globe-stat-group-title">Countries</span>
          {stats.byCountry.map(([country, count]) => (
            <div key={country} className="globe-stat-row"><span>{country}</span><span className="globe-stat-num">{count}</span></div>
          ))}
        </div>
      )}
      {stats.byDevice.length > 0 && (
        <div className="globe-stat-group">
          <span className="globe-stat-group-title">Devices</span>
          {stats.byDevice.map(([device, count]) => (
            <div key={device} className="globe-stat-row"><span>{device}</span><span className="globe-stat-num">{count}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobeEventLog({ journeys }: { journeys: VisitorJourney[] }) {
  const events = useMemo(() =>
    journeys.slice(0, 10).map(j => ({
      id: j.session_id,
      name: j.visitor_name || j.visitor_email || `visitor_${j.visitor_id.slice(0, 6)}`,
      city: j.city,
      country: j.country,
      path: j.steps.length > 0 ? j.steps[j.steps.length - 1].path : "/",
      startedAt: j.started_at,
      device: j.device_type,
      revenue: j.total_revenue,
      hasRevenue: j.total_revenue > 0,
      isIdentified: j.is_identified,
    })),
    [journeys],
  );

  return (
    <div className="globe-event-log">
      <div className="globe-event-log-title">Live Activity</div>
      {events.map(e => (
        <div key={e.id} className="globe-event-row">
          <div className={`globe-event-dot ${e.hasRevenue ? "revenue" : e.isIdentified ? "identified" : ""}`} />
          <div className="globe-event-info">
            <span className="globe-event-name">{e.name}</span>
            <span className="globe-event-detail">
              {[e.city, e.country].filter(Boolean).join(", ")}
              {e.device ? ` · ${e.device}` : ""} · {e.path}
            </span>
          </div>
          <span className="globe-event-time">{timeAgo(e.startedAt)}</span>
          {e.hasRevenue && <span className="globe-event-revenue">${e.revenue}</span>}
        </div>
      ))}
    </div>
  );
}

function GlobeMarkerPopup({ city, journeys, onClose }: { city: string; journeys: VisitorJourney[]; onClose: () => void }) {
  return (
    <div className="globe-marker-popup-overlay" onClick={onClose}>
      <div className="globe-marker-popup" onClick={e => e.stopPropagation()}>
        <div className="globe-popup-header">
          <span className="globe-popup-city">{city}</span>
          <span className="globe-popup-count">{journeys.length} visitor{journeys.length !== 1 ? "s" : ""}</span>
          <button className="globe-popup-close" onClick={onClose}>✕</button>
        </div>
        <div className="globe-popup-list">
          {journeys.map(j => (
            <div key={j.session_id} className="globe-popup-visitor">
              <div className="globe-popup-visitor-header">
                <div className={`globe-popup-avatar ${j.is_identified ? "identified" : ""}`}>
                  {(j.visitor_name || j.visitor_email || "?")[0].toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="globe-popup-name">{j.visitor_name || "Unknown"}</div>
                  <div className="globe-popup-meta">{[j.device_type, j.browser].filter(Boolean).join(" · ")}</div>
                </div>
                {j.total_revenue > 0 && <span className="globe-popup-revenue">${j.total_revenue}</span>}
              </div>
              <div className="globe-popup-session">
                <span className="globe-popup-path">{j.steps.length > 0 ? j.steps[j.steps.length - 1].path : "/"}</span>
                <span className="globe-popup-duration">{sessionDuration(j)}</span>
              </div>
              {j.steps.length > 0 && (
                <div className="globe-popup-steps">
                  {j.steps.slice(-6).map((step, i) => (
                    <span key={i} className={`globe-popup-step ${step.event_type}`}>
                      {step.event_type === "pageview" ? step.path : step.name || step.event_type}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const RANGE_PRESETS = [{ key: "24h", label: "24h" }, { key: "7d", label: "7d" }, { key: "30d", label: "30d" }, { key: "90d", label: "90d" }];

function SiteDetailPage() {
  const siteId = getActiveSiteId() ?? "";
  const queryClient = useQueryClient();
  const [range, setRange] = useState("7d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<VisitorJourney | null>(null);
  const [locationView, setLocationView] = useState<"cards" | "globe">("cards");
  const [selectedGlobeCity, setSelectedGlobeCity] = useState<string | null>(null);

  const effectiveRange = showCustom && customStart && customEnd ? `${customStart},${customEnd}` : range;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", siteId, effectiveRange],
    queryFn: () => fetchDashboard(siteId, showCustom && customStart && customEnd ? undefined : range, showCustom ? customStart : undefined, showCustom ? customEnd : undefined),
    enabled: !!siteId,
    refetchInterval: 60000,
  });

  const { data: funnelData } = useQuery({
    queryKey: ["funnel", siteId, effectiveRange],
    queryFn: () => fetchFunnel(siteId, showCustom && customStart && customEnd ? undefined : range),
    enabled: !!siteId,
    refetchInterval: 60000,
  });

  const { data: geoData } = useQuery({
    queryKey: ["geo", siteId, effectiveRange],
    queryFn: () => fetchGeo(siteId, showCustom && customStart && customEnd ? undefined : range),
    enabled: !!siteId,
    refetchInterval: 60000,
  });

  // SSE for real-time updates — refetch dashboard on new events
  useEffect(() => {
    if (!siteId) return;
    const disconnect = connectSSE(siteId, (ev) => {
      if (ev.type === "visitor" || ev.type === "stats") {
        queryClient.invalidateQueries({ queryKey: ["dashboard", siteId] });
        queryClient.invalidateQueries({ queryKey: ["funnel", siteId] });
        queryClient.invalidateQueries({ queryKey: ["geo", siteId] });
      }
    });
    return disconnect;
  }, [siteId, queryClient]);

  // Sync widget data on dashboard update
  useEffect(() => {
    if (!data || !Capacitor.isNativePlatform()) return;
    import("@/plugins/klikapa-widget-bridge").then(({ KlikapaWidgetBridge }) => {
      KlikapaWidgetBridge.saveWidgetData({
        siteName: siteId,
        visitors: data.stats.visitors,
        pageviews: data.stats.pageviews,
        trend: 0,
        sparkline: [],
        updatedAt: new Date().toISOString(),
      });
    }).catch(() => {});
  }, [data]);

  if (!siteId) {
    return <div className="empty-state" style={{ flex: 1 }}><p>{t("sites.select_site")}</p></div>;
  }

  const hasNoData = !isLoading && data && data.stats.pageviews === 0;
  const stats = data?.stats;
  const journeys = data?.journeys ?? [];
  const topPages = data?.topPages ?? [];
  const sources = data?.sources ?? [];
  const timeseries = data?.timeseries ?? [];

  const globeMarkers = useMemo(() => geoToMarkers(geoData ?? []), [geoData]);

  if (hasNoData) return <EmptyState siteId={siteId} />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="range-bar">
        {RANGE_PRESETS.map((r) => (
          <button key={r.key} className={`btn-pill ${!showCustom && range === r.key ? "active" : ""}`}
            onClick={() => { setRange(r.key); setShowCustom(false); }}>{r.label}</button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
        <button className={`btn-pill ${showCustom ? "active" : ""}`} onClick={() => setShowCustom(!showCustom)}>Custom</button>
        {showCustom && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ fontSize: 12, padding: "6px 10px" }} />
            <span style={{ fontSize: 12, color: "var(--text3)" }}>→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ fontSize: 12, padding: "6px 10px" }} />
            {customStart && customEnd && (
              <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}>Apply</button>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn-pill" onClick={() => exportData(siteId, "events", "csv", range)} title="Export CSV">↓ CSV</button>
        <div className="location-tabs">
          <button className={`location-tab ${locationView === "cards" ? "active" : ""}`} onClick={() => { setLocationView("cards"); setSelectedGlobeCity(null); }}>Cards</button>
          <button className={`location-tab ${locationView === "globe" ? "active" : ""}`} onClick={() => { setLocationView("globe"); setSelectedGlobeCity(null); }}>Globe</button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>
      ) : locationView === "globe" ? (
        <div className="detail-scroll">
          <div className="globe-view-layout">
            <div className="globe-view-sidebar">
              <GlobeSummaryPanel journeys={journeys} />
              <GlobeEventLog journeys={journeys} />
            </div>
            <div className="globe-view-main">
              <div className="globe-header">
                <span className="globe-title">{t("table.locations")}</span>
                {geoData && <span className="globe-count">{geoData.reduce((s, g) => s + g.visitors, 0).toLocaleString()} visitors from {geoData.length} locations</span>}
              </div>
              <div className="globe-canvas-wrap">
                <Globe
                  markers={globeMarkers}
                  paused={!!selectedGlobeCity}
                  onMarkerClick={(marker) => setSelectedGlobeCity(marker.city ?? null)}
                />
              </div>
              {selectedGlobeCity && (
                <GlobeMarkerPopup
                  city={selectedGlobeCity}
                  journeys={journeys.filter(j => j.city === selectedGlobeCity)}
                  onClose={() => setSelectedGlobeCity(null)}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="detail-scroll">
          <AiInsightsCard siteId={siteId} range={range} />
          <div className="metrics-grid">
            <MetricCard label={t("metric.views")} value={stats?.pageviews?.toLocaleString() ?? "0"} />
            <MetricCard label={t("metric.visitors")} value={stats?.visitors?.toLocaleString() ?? "0"} />
            <MetricCard label={t("metric.sessions")} value={stats?.sessions?.toLocaleString() ?? "0"} />
            <MetricCard label={t("metric.bounce_rate")} value={`${stats?.bounceRate ?? 0}%`} />
            <MetricCard label={t("metric.conversions")} value={stats?.conversions?.toLocaleString() ?? "0"} />
            <MetricCard label={t("metric.revenue")} value={`$${stats?.revenue ?? 0}`} />
          </div>

          <EventCalculator currentEvents={(stats?.pageviews ?? 0) + (stats?.conversions ?? 0)} currentPlan="starter" />

          <div className="chart-funnel-row">
            <ChartCard data={timeseries} loading={isLoading} />
            <FunnelChart steps={funnelData?.steps ?? []} totalVisitors={funnelData?.totalVisitors ?? 0} conversionRate={funnelData?.conversionRate ?? 0} />
          </div>

          <DataTable
            title={t("table.locations")}
            rows={(geoData ?? []).map((g) => ({
              city: g.city ?? "Unknown",
              region: g.region ?? "—",
              country: g.country ?? "—",
              visitors: g.visitors.toLocaleString(),
            }))}
            columns={[
              { key: "city", label: t("table.city") },
              { key: "region", label: t("table.region") },
              { key: "country", label: t("table.country") },
              { key: "visitors", label: t("table.visitors"), align: "right", mono: true },
            ]}
          />

          <div className="tables-row">
            <DataTable title={t("table.top_pages")} rows={topPages.map((p) => ({ path: p.path, views: p.pageviews.toLocaleString(), visitors: p.visitors.toLocaleString() }))}
              columns={[{ key: "path", label: t("table.page") }, { key: "views", label: t("table.views"), align: "right", mono: true }, { key: "visitors", label: t("table.visitors"), align: "right", mono: true }]} />
            <DataTable title={t("table.traffic_sources")} rows={sources.map((s) => ({ source: s.source, pct: `${s.percentage}%` }))}
              columns={[{ key: "source", label: t("table.source") }, { key: "pct", label: "Share", align: "right", mono: true }]} />
          </div>

          {/* Journeys — Hero Section */}
          <div className="journeys-section">
            <div className="journeys-header">
              <span className="journeys-title">{t("journeys.title")}</span>
              <span className="journeys-count">{journeys.length}</span>
            </div>
            {journeys.length === 0 ? (
              <div style={{ padding: 20, color: "var(--text3)", fontSize: 13, textAlign: "center" }}>{t("journeys.no_activity")}</div>
            ) : (
              <div className="journeys-list">
                {journeys.map((j) => (
                  <JourneyCard key={j.session_id} journey={j} selected={selectedJourney?.session_id === j.session_id} onClick={() => setSelectedJourney(j)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedJourney && <ProfilePanel journey={selectedJourney} onClose={() => setSelectedJourney(null)} />}
    </div>
  );
}

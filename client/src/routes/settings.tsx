import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getActiveSiteId, fetchSegments, createSegment, deleteSegment, fetchAnnotations, createAnnotation, deleteAnnotation, fetchEmailReports, createEmailReport, updateEmailReport, deleteEmailReport, fetchShareStatus, togglePublicDashboard } from "@/lib/api";
import { t } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <h3 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text)", marginBottom: 16 }}>{title}</h3>
      {children}
    </div>
  );
}

function SegmentsSection() {
  const siteId = getActiveSiteId() ?? "";
  const qc = useQueryClient();
  const { data: segments, isLoading } = useQuery({ queryKey: ["segments", siteId], queryFn: () => fetchSegments(siteId), enabled: !!siteId });
  const [name, setName] = useState("");
  const [dim, setDim] = useState("country");
  const [op, setOp] = useState("is");
  const [val, setVal] = useState("");

  const createMut = useMutation({
    mutationFn: () => createSegment(siteId, name, [{ dimension: dim, operator: op, value: val }]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["segments", siteId] }); setName(""); setVal(""); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSegment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["segments", siteId] }),
  });

  if (isLoading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" style={{ flex: 1, minWidth: 120 }} />
        <select value={dim} onChange={(e) => setDim(e.target.value)} style={{ fontSize: 12 }}>
          {["country", "device_type", "browser", "os", "path", "referrer", "utm_source", "utm_medium", "utm_campaign"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={op} onChange={(e) => setOp(e.target.value)} style={{ fontSize: 12 }}>
          <option value="is">is</option>
          <option value="is_not">is not</option>
          <option value="contains">contains</option>
        </select>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Value" style={{ width: 120 }} />
        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => createMut.mutate()} disabled={!name || !val}>
          Save
        </button>
      </div>
      {segments && segments.length > 0 ? (
        <div className="scroll-x">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Filter</th><th></th></tr></thead>
            <tbody>
              {segments.map((s) => {
                let filters: { dimension: string; operator: string; value: string }[] = [];
                try { filters = JSON.parse(s.filters); } catch {}
                return (
                  <tr key={s.id}>
                    <td style={{ fontSize: 13 }}>{s.name}</td>
                    <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>
                      {filters.map((f) => `${f.dimension} ${f.operator} ${f.value}`).join(", ")}
                    </td>
                    <td>
                      <button className="btn-pill" style={{ fontSize: 11, padding: "3px 8px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }} onClick={() => deleteMut.mutate(s.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: "var(--text3)", fontSize: 12 }}>No saved segments yet</div>
      )}
    </div>
  );
}

function AnnotationsSection() {
  const siteId = getActiveSiteId() ?? "";
  const qc = useQueryClient();
  const { data: annotations, isLoading } = useQuery({ queryKey: ["annotations", siteId], queryFn: () => fetchAnnotations(siteId), enabled: !!siteId });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");

  const createMut = useMutation({
    mutationFn: () => createAnnotation(siteId, date, text),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["annotations", siteId] }); setText(""); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAnnotation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["annotations", siteId] }),
  });

  if (isLoading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 140 }} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Annotation text (e.g. Launch v2)" style={{ flex: 1 }} />
        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => createMut.mutate()} disabled={!text}>
          Add
        </button>
      </div>
      {annotations && annotations.length > 0 ? (
        <div className="scroll-x">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Text</th><th></th></tr></thead>
            <tbody>
              {annotations.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{a.date}</td>
                  <td style={{ fontSize: 13 }}>{a.text}</td>
                  <td>
                    <button className="btn-pill" style={{ fontSize: 11, padding: "3px 8px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }} onClick={() => deleteMut.mutate(a.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: "var(--text3)", fontSize: 12 }}>No annotations yet</div>
      )}
    </div>
  );
}

function EmailReportsSection() {
  const siteId = getActiveSiteId() ?? "";
  const qc = useQueryClient();
  const { data: reports, isLoading } = useQuery({ queryKey: ["email-reports", siteId], queryFn: () => fetchEmailReports(siteId), enabled: !!siteId });
  const [freq, setFreq] = useState("weekly");

  const createMut = useMutation({
    mutationFn: () => createEmailReport(siteId, freq),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-reports", siteId] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEmailReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-reports", siteId] }),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateEmailReport(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-reports", siteId] }),
  });

  if (isLoading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>Schedule:</span>
        <select value={freq} onChange={(e) => setFreq(e.target.value)} style={{ fontSize: 12 }}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => createMut.mutate()}>
          Create Report
        </button>
      </div>
      {reports && reports.length > 0 ? (
        <div className="scroll-x">
          <table className="data-table">
            <thead><tr><th>Frequency</th><th>Status</th><th>Last Sent</th><th></th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "capitalize" }}>{r.frequency}</td>
                  <td>
                    <button className="btn-pill" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => toggleMut.mutate({ id: r.id, enabled: !r.enabled })}>
                      {r.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>{r.last_sent ? new Date(r.last_sent).toLocaleDateString() : "—"}</td>
                  <td>
                    <button className="btn-pill" style={{ fontSize: 11, padding: "3px 8px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }} onClick={() => deleteMut.mutate(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: "var(--text3)", fontSize: 12 }}>No email reports configured</div>
      )}
    </div>
  );
}

function PublicDashboardSection() {
  const siteId = getActiveSiteId() ?? "";
  const qc = useQueryClient();
  const { data: shareStatus, isLoading } = useQuery({ queryKey: ["share", siteId], queryFn: () => fetchShareStatus(siteId), enabled: !!siteId });
  const [copied, setCopied] = useState(false);

  const toggleMut = useMutation({
    mutationFn: () => togglePublicDashboard(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share", siteId] }),
  });

  if (isLoading) return <div className="spinner" />;

  const shareUrl = shareStatus?.share_token ? `${window.location.origin}/api/public/${shareStatus.share_token}` : "";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => toggleMut.mutate()}>
          {shareStatus?.public ? "Disable Public Dashboard" : "Enable Public Dashboard"}
        </button>
        {shareStatus?.public && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, padding: "4px 10px", borderRadius: 100, background: "var(--green-dim)", color: "var(--green)", border: "1px solid rgba(52,211,153,.2)" }}>
            Public
          </span>
        )}
      </div>
      {shareStatus?.public && shareUrl && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={shareUrl} readOnly style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 11 }} onClick={(e) => (e.target as HTMLInputElement).select()} />
          <button className="btn-pill" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text3)" }}>
        Share a read-only version of your analytics dashboard via a public link.
      </div>
    </div>
  );
}

function SettingsPage() {
  const siteId = getActiveSiteId();

  if (!siteId) {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <p>{t("sites.select_site")}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="overview-scroll">
        <PageHeader
          title="Settings"
          subtitle="Manage segments, annotations, email reports, and sharing"
          backTo="/site/$siteId"
        />

        <div style={{ maxWidth: 720 }}>
          <Section title="Public Dashboard">
            <PublicDashboardSection />
          </Section>

          <Section title="Saved Segments">
            <SegmentsSection />
          </Section>

          <Section title="Annotations">
            <AnnotationsSection />
          </Section>

          <Section title="Email Reports">
            <EmailReportsSection />
          </Section>
        </div>
      </div>
    </div>
  );
}

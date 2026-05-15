import { useQuery } from "@tanstack/react-query";
import { fetchWebhookEvents } from "@/lib/api";
import { t } from "@/lib/i18n";

export function EventLogTable({ integrationId }: { integrationId: string }) {
  const { data: events, isLoading } = useQuery({
    queryKey: ["webhook-events", integrationId],
    queryFn: () => fetchWebhookEvents(integrationId),
    enabled: !!integrationId,
  });

  if (isLoading) return <div style={{ padding: 16, textAlign: "center" }}><div className="spinner" /></div>;

  const rows = events ?? [];
  if (rows.length === 0) {
    return <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>{t("integrations.no_events")}</div>;
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

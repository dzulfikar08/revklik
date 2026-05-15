import { useState } from "react";
import { WEBHOOK_PATHS } from "./provider-config";

export function WebhookUrlSection({ provider }: { provider: string }) {
  const [copied, setCopied] = useState(false);
  const path = WEBHOOK_PATHS[provider];
  if (!path) return null;
  const url = `${window.location.origin}${path}`;

  return (
    <div style={{ margin: "8px 22px 0", padding: "8px 10px", background: "var(--accent-dim)", borderRadius: 8, border: "1px solid rgba(99,102,241,.15)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        Webhook URL
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <code style={{ flex: 1, fontSize: 10, fontFamily: "var(--mono)", wordBreak: "break-all", color: "var(--text2)" }}>{url}</code>
        <button className="btn-pill" style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap" }}
          onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "var(--text4)", marginTop: 4 }}>
        Paste this URL in your {provider.charAt(0).toUpperCase() + provider.slice(1)} dashboard webhook settings.
      </div>
    </div>
  );
}

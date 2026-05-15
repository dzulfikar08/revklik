import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getActiveSiteId } from "@/lib/api";

export const Route = createFileRoute("/docs/install")({ component: InstallGuidePage });

const PLATFORMS = [
  { key: "html", name: "HTML" },
  { key: "wordpress", name: "WordPress" },
  { key: "nextjs", name: "Next.js" },
  { key: "webflow", name: "Webflow" },
  { key: "ghost", name: "Ghost" },
  { key: "shopify", name: "Shopify" },
  { key: "wix", name: "Wix" },
  { key: "squarespace", name: "Squarespace" },
  { key: "nuxt", name: "Nuxt" },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

const PLATFORM_STEPS: Record<PlatformKey, string> = {
  html: "Add the script tag to your HTML <head> section, before the closing </head> tag.",
  wordpress:
    "Install the 'Insert Headers and Footers' plugin. Go to Settings \u2192 Insert Headers and Footers and paste the script in the Scripts in Header section. Alternatively, add it to your theme's header.php file.",
  nextjs:
    "Create a file at app/layout.tsx (or pages/_document.tsx for Pages Router) and add the script to the <Head> component. For App Router, use next/script with strategy='afterInteractive'.",
  webflow:
    "Go to Project Settings \u2192 Custom Code \u2192 Footer Code. Paste the script and save. Publish your site.",
  ghost: "Go to Settings \u2192 Code Injection \u2192 Site Header. Paste the script and save.",
  shopify:
    "Go to Online Store \u2192 Themes \u2192 Actions \u2192 Edit Code. Open theme.liquid and add the script before </head>.",
  wix: "Go to Settings \u2192 Custom Code \u2192 Header. Add a new custom code block and paste the script.",
  squarespace:
    "Go to Settings \u2192 Advanced \u2192 Code Injection \u2192 Header. Paste the script and save.",
  nuxt: "Add the script to nuxt.config.ts in the head.script array, or create a plugin in plugins/ directory.",
};

function InstallGuidePage() {
  const navigate = useNavigate();
  const siteId = getActiveSiteId() ?? "YOUR_SITE_ID";
  const [activePlatform, setActivePlatform] = useState<PlatformKey>("html");
  const [copied, setCopied] = useState(false);

  const snippetUrl = `${window.location.origin}/api/klikapa.js?site_id=${siteId}`;
  const snippet = `<script defer src="${snippetUrl}"></script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBack = () => {
    if (siteId && siteId !== "YOUR_SITE_ID") {
      navigate({ to: "/site/$siteId", params: { siteId } });
    } else {
      navigate({ to: "/" });
    }
  };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 16px" }}>
      <div className="overview-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <button
            onClick={handleBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text3)",
              fontSize: 18,
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
            title="Back to dashboard"
          >
            &larr;
          </button>
          <h1 className="overview-title">Install Guide</h1>
        </div>
        <p className="overview-sub">Get started with RevKlik in under 2 minutes</p>
      </div>

      {/* Platform tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            className="btn-pill"
            style={
              activePlatform === p.key
                ? { background: "var(--accent-dim)", color: "var(--accent)" }
                : {}
            }
            onClick={() => setActivePlatform(p.key)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Tracking snippet */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 8, fontWeight: 600 }}>
          Tracking snippet
        </div>
        <pre
          style={{
            background: "var(--bg3)",
            borderRadius: 8,
            padding: 14,
            fontFamily: "var(--mono)",
            fontSize: 13,
            overflowX: "auto",
            position: "relative",
            color: "var(--text)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {snippet}
          <button
            onClick={handleCopy}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "var(--bg4)",
              border: "1px solid var(--border2)",
              borderRadius: 6,
              padding: "4px 10px",
              fontFamily: "var(--sans)",
              fontSize: 11,
              color: copied ? "var(--green)" : "var(--text3)",
              cursor: "pointer",
              transition: "color 0.2s",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </pre>
      </div>

      {/* Platform-specific instructions */}
      <div
        style={{
          background: "var(--bg2)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--accent-dim)",
              color: "var(--accent)",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: "var(--mono)",
            }}
          >
            {PLATFORMS.find((p) => p.key === activePlatform)?.name.charAt(0)}
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 18,
              color: "var(--text)",
            }}
          >
            {PLATFORMS.find((p) => p.key === activePlatform)?.name}
          </div>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          {PLATFORM_STEPS[activePlatform]}
        </p>
      </div>

      {/* Verification note */}
      <div
        style={{
          marginTop: 20,
          padding: 14,
          borderRadius: 8,
          background: "var(--green-dim)",
          fontSize: 12,
          color: "var(--green)",
          lineHeight: 1.6,
        }}
      >
        <strong>Tip:</strong> After adding the script, visit your site and check back here
        &mdash; you should see your first visitor appear within seconds.
      </div>
    </div>
  );
}

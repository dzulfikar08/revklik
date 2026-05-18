import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { fetchSites, fetchTokens, createApiToken, revokeApiToken } from "@/lib/api";
import { toast } from "@/components/toast";
import { PageHeader } from "@/components/page-header";

const SCOPES = {
  SITES_READ: "sites:read",
  ANALYTICS_READ: "analytics:read",
  ANALYTICS_EXPORT: "analytics:export",
  TOKENS_READ: "tokens:read",
  TOKENS_WRITE: "tokens:write",
} as const;

const DEFAULT_ACCOUNT_SCOPES = [SCOPES.SITES_READ, SCOPES.ANALYTICS_READ, SCOPES.ANALYTICS_EXPORT, SCOPES.TOKENS_READ, SCOPES.TOKENS_WRITE];
const DEFAULT_SITE_SCOPES = [SCOPES.ANALYTICS_READ, SCOPES.ANALYTICS_EXPORT];

type TokenInfo = {
  id: string; prefix: string; name: string; type: "account" | "site";
  scopes: string[]; site_id: string | null; last_used_at: string | null; created_at: string;
};

export const Route = createFileRoute("/settings/api-tokens")({
  component: ApiTokensPage,
});

const ALL_SCOPES = [
  { key: SCOPES.SITES_READ, label: "Sites: Read", desc: "List and view sites" },
  { key: SCOPES.ANALYTICS_READ, label: "Analytics: Read", desc: "View analytics data" },
  { key: SCOPES.ANALYTICS_EXPORT, label: "Analytics: Export", desc: "Export analytics data" },
  { key: SCOPES.TOKENS_READ, label: "Tokens: Read", desc: "List API tokens" },
  { key: SCOPES.TOKENS_WRITE, label: "Tokens: Write", desc: "Create and revoke tokens" },
];

function CreateTokenModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"account" | "site">("account");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [scopes, setScopes] = useState<string[]>(DEFAULT_ACCOUNT_SCOPES);
  const [error, setError] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: () => fetchSites(),
  });

  const createMut = useMutation({
    mutationFn: () => createApiToken({ name, type, scopes, site_id: type === "site" ? selectedSiteId : undefined }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      setCreatedToken(data.token);
    },
    onError: (err) => setError(err.message),
  });

  const handleTypeChange = (newType: "account" | "site") => {
    setType(newType);
    setScopes(newType === "account" ? DEFAULT_ACCOUNT_SCOPES : DEFAULT_SITE_SCOPES);
  };

  const toggleScope = (scope: string) => {
    setScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  };

  // Site tokens can only have analytics scopes
  const availableScopes = type === "site"
    ? ALL_SCOPES.filter((s) => (["analytics:read", "analytics:export"] as string[]).includes(s.key))
    : ALL_SCOPES;

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      toast("Token copied to clipboard", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Failed to copy token", "error");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)" }} onClick={onClose}>
      <div style={{ width: 520, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 16, padding: 24, animation: "fadeUp 0.25s cubic-bezier(0.16,1,0.3,1)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 20, color: "var(--text)" }}>
            {createdToken ? "Token Created" : "Create API Token"}
          </div>
          <button onClick={onClose} style={{ fontSize: 16, color: "var(--text3)", padding: "4px 8px", background: "none", border: "none", cursor: "pointer" }}>✕</button>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "var(--crit)", background: "var(--crit-dim)", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
            {error}
          </div>
        )}

        {createdToken ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 12, color: "var(--crit)", background: "var(--crit-dim)", borderRadius: 8, padding: "10px 14px", fontWeight: 600 }}>
              Copy this token now — it won't be shown again.
            </div>
            <div style={{ position: "relative", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", paddingRight: 80 }}>
              <code style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--text)", wordBreak: "break-all" }}>
                {createdToken}
              </code>
              <button
                onClick={handleCopy}
                style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: copied ? "var(--green-dim)" : "var(--bg3)", border: `1px solid ${copied ? "rgba(52,211,153,.3)" : "var(--border)"}`,
                  borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                  fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600,
                  color: copied ? "var(--green)" : "var(--text2)",
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn-accent" onClick={onClose} style={{ fontSize: 13, padding: "8px 18px" }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Name */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Token Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My CLI, CI/CD, Analytics Export"
                style={{ width: "100%", fontFamily: "var(--sans)", fontSize: 13 }}
              />
            </div>

            {/* Type */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Token Type</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleTypeChange("account")}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${type === "account" ? "var(--accent)" : "var(--border)"}`,
                    background: type === "account" ? "var(--accent-dim)" : "var(--bg)",
                    color: type === "account" ? "var(--accent)" : "var(--text2)",
                    fontFamily: "var(--sans)", fontSize: 13, textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>Account</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Full access across all sites</div>
                </button>
                <button
                  onClick={() => handleTypeChange("site")}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${type === "site" ? "var(--accent)" : "var(--border)"}`,
                    background: type === "site" ? "var(--accent-dim)" : "var(--bg)",
                    color: type === "site" ? "var(--accent)" : "var(--text2)",
                    fontFamily: "var(--sans)", fontSize: 13, textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>Site</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Scoped to a single site</div>
                </button>
              </div>
            </div>

            {/* Site selector (only for site type) */}
            {type === "site" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Select Site</label>
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 12px", borderRadius: 8,
                    background: "var(--bg)", border: "1px solid var(--border)",
                    color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13,
                  }}
                >
                  <option value="">Choose a site...</option>
                  {sites?.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {s.domain}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Scopes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Scopes</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {availableScopes.map((scope) => (
                  <label key={scope.key} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderRadius: 8, cursor: "pointer",
                    background: scopes.includes(scope.key) ? "var(--accent-dim)" : "transparent",
                    border: `1px solid ${scopes.includes(scope.key) ? "rgba(99,102,241,.2)" : "var(--border)"}`,
                    transition: "all 0.15s ease",
                  }}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope.key)}
                      onChange={() => toggleScope(scope.key)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{scope.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{scope.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Create button */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                className="btn-accent"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !name || (type === "site" && !selectedSiteId)}
                style={{ opacity: createMut.isPending || !name || (type === "site" && !selectedSiteId) ? 0.6 : 1, fontSize: 13, padding: "8px 18px" }}
              >
                {createMut.isPending ? "Creating..." : "Create Token"}
              </button>
              <button className="btn-pill" onClick={onClose} style={{ fontSize: 13, padding: "8px 18px" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenRow({ token, onRevoke }: { token: TokenInfo; onRevoke: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const typeColor = token.type === "account" ? "var(--accent)" : "var(--green)";
  const typeBg = token.type === "account" ? "var(--accent-dim)" : "var(--green-dim)";

  return (
    <div style={{
      padding: "16px 20px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 16,
    }}>
      {/* Token info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, color: "var(--text)" }}>
            {token.name}
          </span>
          <span style={{
            fontFamily: "var(--mono)", fontSize: 9, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 100,
            background: typeBg, color: typeColor,
            border: `1px solid ${token.type === "account" ? "rgba(99,102,241,.2)" : "rgba(52,211,153,.2)"}`,
          }}>
            {token.type}
          </span>
          <span style={{
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)",
            background: "var(--bg3)", padding: "2px 8px", borderRadius: 6,
          }}>
            {token.prefix}...
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          {token.scopes.map((scope) => (
            <span key={scope} style={{
              fontFamily: "var(--mono)", fontSize: 9, fontWeight: 500,
              padding: "2px 6px", borderRadius: 4,
              background: "var(--bg)", border: "1px solid var(--border2)",
              color: "var(--text3)",
            }}>
              {scope}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text4)", fontFamily: "var(--mono)" }}>
          <span>Created {new Date(token.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          {token.last_used_at && (
            <span>Last used {new Date(token.last_used_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          )}
        </div>
      </div>

      {/* Revoke button */}
      <div>
        {confirming ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--crit)", fontFamily: "var(--mono)" }}>Revoke?</span>
            <button
              onClick={() => onRevoke(token.id)}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                background: "var(--crit-dim)", border: "1px solid rgba(239,68,68,.3)",
                color: "var(--crit)", fontFamily: "var(--mono)", fontWeight: 600,
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                background: "var(--bg3)", border: "1px solid var(--border)",
                color: "var(--text3)", fontFamily: "var(--mono)",
              }}
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="btn-pill"
            style={{ fontSize: 11, padding: "5px 12px", color: "var(--crit)", borderColor: "rgba(239,68,68,.2)" }}
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}

function ApiTokensPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: tokens, isLoading } = useQuery({
    queryKey: ["tokens"],
    queryFn: () => fetchTokens(),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      toast("Token revoked", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });

  const tokenList = tokens ?? [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="overview-scroll">
        <PageHeader
          title="API Tokens"
          subtitle="Create tokens to access the RevKlik API or CLI."
          backTo="/settings"
          action={
            <button className="btn-accent" onClick={() => setShowCreate(true)} style={{ fontSize: 13, padding: "8px 18px" }}>
              + Create Token
            </button>
          }
        />

        {/* Token list */}
        <div style={{ padding: "0 24px", maxWidth: 900 }}>
          {isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
              <div className="spinner" />
            </div>
          ) : tokenList.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "60px 20px",
              background: "var(--bg2)", borderRadius: 16, border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>&#123;&#125;</div>
              <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text2)", marginBottom: 8 }}>
                No API tokens yet
              </div>
              <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20 }}>
                Create a token to authenticate CLI commands or API requests.
              </div>
              <button className="btn-accent" onClick={() => setShowCreate(true)} style={{ fontSize: 13, padding: "8px 18px" }}>
                + Create Token
              </button>
            </div>
          ) : (
            <div style={{
              background: "var(--bg2)", borderRadius: 16, border: "1px solid var(--border)",
              overflow: "hidden",
            }}>
              {tokenList.map((token) => (
                <TokenRow key={token.id} token={token} onRevoke={(id) => revokeMut.mutate(id)} />
              ))}
            </div>
          )}
        </div>

        {/* Install instructions */}
        <div style={{ padding: "32px 24px", maxWidth: 900 }}>
          <div style={{
            background: "var(--bg2)", borderRadius: 16, border: "1px solid var(--border)",
            padding: 24,
          }}>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--text)", marginBottom: 16 }}>
              Using the CLI
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  1. Install the CLI
                </div>
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
                  padding: "12px 16px", fontFamily: "var(--mono)", fontSize: 13, color: "var(--text)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span>npm install -g @revklik/cli</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText("npm install -g @revklik/cli"); toast("Copied", "success"); }}
                    style={{
                      background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "4px 10px", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10,
                      color: "var(--text3)",
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  2. Login with your token
                </div>
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
                  padding: "12px 16px", fontFamily: "var(--mono)", fontSize: 13, color: "var(--text)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span>revklik login</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText("revklik login"); toast("Copied", "success"); }}
                    style={{
                      background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "4px 10px", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 10,
                      color: "var(--text3)",
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateTokenModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

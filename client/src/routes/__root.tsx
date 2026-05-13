import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLoggedIn, fetchSites, getActiveSiteId, setActiveSiteId, logout } from "@/lib/api";
import { useState, useRef, useEffect } from "react";

export const Route = createRootRoute({ component: RootLayout });

function SiteSwitcher({ sites, siteId, onSelect, onBack }: { sites: { id: string; name: string }[]; siteId: string; onSelect: (id: string) => void; onBack: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = sites.find((s) => s.id === siteId);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "4px 8px", borderRadius: 6,
          background: open ? "var(--hover-overlay)" : "transparent",
          border: "1px solid var(--border)", color: "var(--cyan)",
          fontSize: 12, fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
          cursor: "pointer", maxWidth: 180,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.name || siteId}</span>
        <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.3)", minWidth: 200, maxWidth: 280,
          zIndex: 200, overflow: "hidden",
        }}>
          <button
            onClick={() => { onBack(); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "10px 14px", border: "none",
              background: "transparent", color: "var(--muted)", fontSize: 12,
              cursor: "pointer", borderBottom: "1px solid var(--border)", textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            ← All Sites
          </button>
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => { onSelect(s.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "10px 14px", border: "none",
                background: s.id === siteId ? "var(--hover-overlay)" : "transparent",
                color: s.id === siteId ? "var(--cyan)" : "var(--fg)",
                fontSize: 12, fontFamily: "JetBrains Mono, monospace", fontWeight: s.id === siteId ? 600 : 400,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = s.id === siteId ? "var(--hover-overlay)" : "transparent")}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              {s.id === siteId && <span style={{ fontSize: 10, color: "var(--cyan)" }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authenticated = isLoggedIn();
  const siteId = getActiveSiteId();
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";

  if (!authenticated && !isAuthPage) { navigate({ to: "/login" }); return null; }
  if (isAuthPage) return <div style={{ height: "100vh" }}><Outlet /></div>;

  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      <header className="header-pad" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 52, borderBottom: "1px solid var(--border)",
        background: "var(--card)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={() => navigate({ to: "/" })} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: "none", border: "none" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6, background: "var(--cyan)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14, color: "#fff", flexShrink: 0,
            }}>K</div>
            <span className="header-logo-text" style={{ fontWeight: 600, fontSize: 14, color: "var(--fg)", whiteSpace: "nowrap" }}>klikapa</span>
          </button>
          {siteId && sites && sites.length > 0 && (
            <>
              <span style={{ color: "var(--border)", fontSize: 12 }} className="hide-mobile">/</span>
              <SiteSwitcher
                sites={sites}
                siteId={siteId}
                onSelect={(id) => {
                  setActiveSiteId(id);
                  queryClient.invalidateQueries();
                  if (location.pathname !== "/site") navigate({ to: "/site" });
                }}
                onBack={() => { localStorage.removeItem("kp_active_site"); queryClient.invalidateQueries(); navigate({ to: "/" }); }}
              />
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => { logout(); queryClient.clear(); navigate({ to: "/login" }); }} style={{
            padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
            background: "transparent", color: "var(--muted)", fontSize: 12, fontWeight: 600,
            cursor: "pointer", flexShrink: 0,
          }}>
            <span className="hide-mobile">Logout</span>
            <span className="hide-desktop" style={{ fontSize: 14 }}>✕</span>
          </button>
        </div>
      </header>
      <main style={{ flex: 1, overflow: "hidden" }}>
        <Outlet />
      </main>
    </div>
  );
}

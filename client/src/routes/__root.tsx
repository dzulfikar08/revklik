import { createRootRoute, Outlet, useLocation, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLoggedIn, fetchSites, setActiveSiteId, logout } from "@/lib/api";
import { useState, useRef, useEffect } from "react";
import { t, toggleLang, getLang } from "@/lib/i18n";
import { ToastContainer } from "@/components/toast";
import { initPushNotifications } from "@/lib/push";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createRootRoute({ component: RootLayout });

function SiteSwitcher({ sites, currentSiteId, onNavigate }: {
  sites: { id: string; name: string }[];
  currentSiteId: string;
  onNavigate: (siteId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const current = sites.find((s) => s.id === currentSiteId);

  return (
    <div ref={ref} className="site-switcher">
      <button className="site-switcher-btn" onClick={() => setOpen((v) => !v)}>
        <span>{current?.name || t("sites.all_sites")}</span>
        <span style={{ fontSize: 9 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="site-switcher-dropdown">
          <button className="site-switcher-item" onClick={() => { onNavigate(null); setOpen(false); }}>
            ← {t("sites.all_sites")}
          </button>
          {sites.map((s) => (
            <button key={s.id}
              className={`site-switcher-item ${s.id === currentSiteId ? "active" : ""}`}
              onClick={() => { onNavigate(s.id); setOpen(false); }}
            >
              <span>{s.name}</span>
              {s.id === currentSiteId && <span style={{ fontSize: 10, color: "var(--accent)" }}>✓</span>}
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

  // Handle Google OAuth callback token from URL fragment
  useEffect(() => {
    const hash = window.location.hash;
    const m = hash.match(/token=([^&]+)/);
    if (m && m[1]) {
      const token = decodeURIComponent(m[1]!);
      import("@/lib/mobile-storage").then(({ setItem }) => { setItem("kp_token", token); });
      window.location.hash = "";
      queryClient.invalidateQueries();
      navigate({ to: "/" });
    }
  }, []);

  const authenticated = isLoggedIn();
  const routeState = useRouterState({ select: (s) => s.location });
  const siteMatch = routeState.pathname.match(/^\/site\/([^/]+)/);
  const siteId = siteMatch ? siteMatch[1]! : null;
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";

  if (!authenticated && !isAuthPage) { navigate({ to: "/login" }); return null; }
  if (isAuthPage) return <div style={{ height: "100vh" }}><Outlet /></div>;

  useEffect(() => { initPushNotifications(); }, []);

  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const sitesList = sites ?? [];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header className="topnav">
        <div className="topnav-left">
          <button className="topnav-logo" onClick={() => navigate({ to: "/" })}>
            <img src="/revklik.webp" alt="" className="topnav-logo-icon" />
            <span className="topnav-logo-text">RevKlik</span>
          </button>
          {siteId && sitesList.length > 0 && (
            <>
              <div className="topnav-divider" />
              <SiteSwitcher
                sites={sitesList}
                currentSiteId={siteId}
                onNavigate={(id) => {
                  if (id) {
                    setActiveSiteId(id);
                    navigate({ to: "/site/$siteId", params: { siteId: id } });
                  } else {
                    navigate({ to: "/" });
                  }
                }}
              />
            </>
          )}
        </div>
        <div className="topnav-right">
          <button className="btn-pill" onClick={() => navigate({ to: "/settings" })} style={{ fontSize: 11, padding: "4px 10px", marginRight: 8 }}>
            Settings
          </button>
          <button className="btn-pill" onClick={() => navigate({ to: "/settings/api-tokens" })} style={{ fontSize: 11, padding: "4px 10px", marginRight: 8 }}>
            API Tokens
          </button>
          <button className="btn-pill" onClick={() => { toggleLang(); queryClient.invalidateQueries(); window.location.reload(); }} style={{ fontSize: 11, padding: "4px 10px", marginRight: 8 }}>
            {getLang() === "en" ? "ID" : "EN"}
          </button>
          <button className="btn-pill" onClick={() => { logout(); queryClient.clear(); navigate({ to: "/login" }); }}>
            {t("nav.logout")}
          </button>
        </div>
      </header>
      <TooltipProvider delayDuration={200}>
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Outlet />
        </main>
      </TooltipProvider>
      <ToastContainer />
    </div>
  );
}

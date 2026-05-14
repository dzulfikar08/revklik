import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLoggedIn, fetchSites, getActiveSiteId, setActiveSiteId, logout } from "@/lib/api";
import { useState, useRef, useEffect } from "react";
import { t, toggleLang, getLang } from "@/lib/i18n";
import { ToastContainer } from "@/components/toast";
import { removeItem } from "@/lib/mobile-storage";
import { initPushNotifications } from "@/lib/push";

export const Route = createRootRoute({ component: RootLayout });

function SiteSwitcher({ sites, siteId, onSelect, onBack }: {
  sites: { id: string; name: string }[];
  siteId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const current = sites.find((s) => s.id === siteId);

  return (
    <div ref={ref} className="site-switcher">
      <button className="site-switcher-btn" onClick={() => setOpen((v) => !v)}>
        <span>{current?.name || t("sites.all_sites")}</span>
        <span style={{ fontSize: 9 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="site-switcher-dropdown">
          <button className="site-switcher-item" onClick={() => { onBack(); setOpen(false); }}>
            ← {t("sites.all_sites")}
          </button>
          {sites.map((s) => (
            <button key={s.id}
              className={`site-switcher-item ${s.id === siteId ? "active" : ""}`}
              onClick={() => { onSelect(s.id); setOpen(false); }}
            >
              <span>{s.name}</span>
              {s.id === siteId && <span style={{ fontSize: 10, color: "var(--accent)" }}>✓</span>}
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

  useEffect(() => { initPushNotifications(); }, []);

  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const sitesList = sites ?? [];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header className="topnav">
        <div className="topnav-left">
          <button className="topnav-logo" onClick={() => navigate({ to: "/" })}>
            <div className="topnav-logo-mark">k</div>
            <span className="topnav-logo-text">klikapa</span>
          </button>
          {siteId && sitesList.length > 0 && (
            <>
              <div className="topnav-divider" />
              <SiteSwitcher
                sites={sitesList}
                siteId={siteId}
                onSelect={(id) => {
                  setActiveSiteId(id);
                  queryClient.invalidateQueries();
                  if (location.pathname !== "/site") navigate({ to: "/site" });
                }}
                onBack={() => {
                  removeItem("kp_active_site");
                  queryClient.invalidateQueries();
                  navigate({ to: "/" });
                }}
              />
            </>
          )}
        </div>
        <div className="topnav-right">
          <button className="btn-pill" onClick={() => { toggleLang(); queryClient.invalidateQueries(); window.location.reload(); }} style={{ fontSize: 11, padding: "4px 10px", marginRight: 8 }}>
            {getLang() === "en" ? "ID" : "EN"}
          </button>
          <button className="btn-pill" onClick={() => { logout(); queryClient.clear(); navigate({ to: "/login" }); }}>
            {t("nav.logout")}
          </button>
        </div>
      </header>
      <main style={{ flex: 1, overflow: "hidden" }}>
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}

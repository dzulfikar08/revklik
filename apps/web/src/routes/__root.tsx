import { Toaster } from "@revklik-new/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";

import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "revklik",
      },
      {
        name: "description",
        content: "revklik — privacy-friendly web analytics",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/webp",
        href: "/revklik.webp",
      },
    ],
  }),
});

/* Dev-only tooling: kept out of the production bundle entirely. */
const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      }))
    )
  : () => null;

const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      }))
    )
  : () => null;

/* Async so the user menu stays out of the entry chunk. */
const Header = lazy(() => import("@/components/header"));

/**
 * Google OAuth callback landing: klikapa redirects to /#token=<session>.
 * Store it, resolve the user profile, then enter the dashboard. Runs before
 * the router renders, so any route can absorb the redirect. The relative
 * /api path is same-origin in production (klikapa serves UI and API); local
 * dev signs in with the injected env token instead of Google.
 */
function captureOAuthToken(): void {
  const match = window.location.hash.match(/^#token=(.+)$/);
  if (!match) return;
  const token = decodeURIComponent(match[1]);
  history.replaceState(null, "", window.location.pathname);
  fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: { user?: unknown } };
      if (!json.data?.user) throw new Error("no user");
      localStorage.setItem("kp_token", token);
      localStorage.setItem("kp_user", JSON.stringify(json.data.user));
      window.location.replace("/analytics");
    })
    .catch(() => {
      // Bad/expired token: stay put; the login guard takes it from here.
    });
}

function RootComponent() {
  useEffect(captureOAuthToken, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const chromeless = pathname.startsWith("/analytics");

  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <div className="grid h-svh grid-rows-[auto_1fr]">
          {!chromeless && (
            <Suspense fallback={null}>
              <Header />
            </Suspense>
          )}
          <Outlet />
        </div>
        <Toaster richColors />
      </ThemeProvider>
      <Suspense fallback={null}>
        <RouterDevtools position="bottom-left" />
        <QueryDevtools position="bottom" buttonPosition="bottom-right" />
      </Suspense>
    </>
  );
}

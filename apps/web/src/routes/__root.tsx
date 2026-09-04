import { Toaster } from "@revklik-new/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

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

/* Async so the better-auth client (user menu) stays out of the entry chunk. */
const Header = lazy(() => import("@/components/header"));

function RootComponent() {
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

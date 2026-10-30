import { buttonVariants } from "@revklik/ui/components/button";
import { Toaster } from "@revklik/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	HeadContent,
	Link,
	Outlet,
	createRootRouteWithContext,
	useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";

import { AuthShell, authButtonClass } from "@/components/auth-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { useT } from "@/lib/i18n";
import { rememberToken } from "@/lib/legacy/account-tokens";
import { clearSignupIntent, takeSignupPlan } from "@/lib/signup-intent";

import "../index.css";

export interface RouterAppContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	notFoundComponent: NotFound,
	head: () => ({
		meta: [
			{
				title: "RevKlik",
			},
			{
				name: "description",
				content: "RevKlik: privacy-friendly web analytics",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
				sizes: "16x16 32x32 48x48",
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
		],
	}),
});

/* Dev-only tooling: kept out of the production bundle entirely. */
const RouterDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-router-devtools").then((m) => ({
				default: m.TanStackRouterDevtools,
			})),
		)
	: () => null;

const QueryDevtools = import.meta.env.DEV
	? lazy(() =>
			import("@tanstack/react-query-devtools").then((m) => ({
				default: m.ReactQueryDevtools,
			})),
		)
	: () => null;

/* Async so the user menu stays out of the entry chunk. */
const Header = lazy(() => import("@/components/header"));

/**
 * Google OAuth callback landing: klikapa redirects to /#token=<session>.
 * Runs at MODULE EVALUATION — before the router's beforeLoad guards read the
 * session. A useEffect is too late: the redirect chain (/, /analytics →
 * /login) rewrites the URL and strips the hash before any effect fires.
 * Store the token optimistically; /analytics's guard then validates it via
 * /auth/me and legacyLogout bounces back if it is dead.
 */
function captureOAuthToken(): void {
	const match = window.location.hash.match(/^#token=(.+)$/);
	if (!match) return;
	const token = decodeURIComponent(match[1]);
	history.replaceState(null, "", window.location.pathname);
	localStorage.setItem("kp_token", token);
	fetch("/api/auth/me", {
		headers: { Authorization: `Bearer ${token}` },
	})
		.then(async (res) => {
			if (!res.ok) throw new Error(String(res.status));
			const json = (await res.json()) as { data?: { user?: unknown } };
			if (!json.data?.user) throw new Error("no user");
			localStorage.setItem("kp_user", JSON.stringify(json.data.user));
			const { user } = json.data;
			if (
				typeof user === "object" &&
				user !== null &&
				"id" in user &&
				typeof user.id === "string"
			) {
				rememberToken(localStorage, user.id, token);
			}
			// A plan picked on the pricing page before "Continue with Google".
			const plan = takeSignupPlan();
			// The ref went to /auth/google and is attributed server-side now.
			clearSignupIntent();
			window.location.replace(plan ? `/analytics/billing?plan=${plan}` : "/analytics");
		})
		.catch(() => {
			// Bad/expired token: drop it; the login guard takes it from here.
			localStorage.removeItem("kp_token");
			localStorage.removeItem("kp_user");
		});
}

/**
 * Google link flow lands back on the settings page with #link_code=<code>.
 * Keep it in sessionStorage (this tab only) and strip it from the URL before
 * the router rewrites the location; Settings then asks the user to confirm.
 */
function captureLinkCode(): void {
	const match = window.location.hash.match(/^#link_code=(.+)$/);
	if (!match) return;
	sessionStorage.setItem("kp_link_code", decodeURIComponent(match[1]));
	history.replaceState(null, "", window.location.pathname + window.location.search);
}

captureOAuthToken();
captureLinkCode();

const STALE_SHELL_RETRY_KEY = "kp_stale_shell_retry";

/**
 * A 404 under an installed service worker usually means the cached app shell
 * predates the route (e.g. /demo after a deploy). Drop the worker and reload
 * once per path from the network; a real 404 stays put after that one retry.
 */
function useStaleShellRecovery(): void {
	useEffect(() => {
		if (!navigator.serviceWorker?.controller) return;
		const path = window.location.pathname;
		if (sessionStorage.getItem(STALE_SHELL_RETRY_KEY) === path) return;
		sessionStorage.setItem(STALE_SHELL_RETRY_KEY, path);
		void (async () => {
			const registrations = await navigator.serviceWorker.getRegistrations();
			await Promise.all(registrations.map((r) => r.unregister()));
			window.location.reload();
		})();
	}, []);
}

function NotFound() {
	const t = useT();
	useStaleShellRecovery();
	return (
		<AuthShell eyebrow="404" title={t("notFound.title")} description={t("notFound.desc")}>
			<Link to="/analytics" className={buttonVariants({ className: authButtonClass })}>
				{t("notFound.home")}
			</Link>
		</AuthShell>
	);
}

function RootComponent() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	// Only the root matched: the URL hit no route and NotFound renders in its own shell.
	const notFound = useRouterState({
		select: (s) => s.matches.length > 0 && s.matches.every((m) => m.routeId === "__root__"),
	});
	const chromeless =
		notFound ||
		pathname.startsWith("/analytics") ||
		pathname.startsWith("/public") ||
		pathname.startsWith("/demo") ||
		pathname === "/login" ||
		pathname === "/register" ||
		pathname === "/reset-password" ||
		pathname === "/verify-email";

	// Embedded demo and public dashboards sit inside the dark landing page.
	const searchStr = useRouterState({ select: (s) => s.location.searchStr });
	const embedded = new URLSearchParams(searchStr).has("embed");
	const forcedTheme = embedded && (pathname.startsWith("/demo") || pathname.startsWith("/public"));

	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				forcedTheme={forcedTheme ? "dark" : undefined}
				disableTransitionOnChange
				storageKey="vite-ui-theme"
			>
				<div className="grid h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] [&>*]:min-w-0">
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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createRootRoute,
	Outlet,
	useLocation,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Subscription } from "shared";
import { ToastContainer } from "@/components/toast";
import { TrialBanner } from "@/components/trial-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	fetchSites,
	fetchSubscription,
	getCurrentUser,
	isLoggedIn,
	logout,
	setActiveSiteId,
} from "@/lib/api";
import { getLang, t, toggleLang } from "@/lib/i18n";
import { setItem } from "@/lib/mobile-storage";
import { initPushNotifications } from "@/lib/push";

export const Route = createRootRoute({ component: RootLayout });

function SiteSwitcher({
	sites,
	currentSiteId,
	onNavigate,
}: {
	sites: { id: string; name: string }[];
	currentSiteId: string | null;
	onNavigate: (siteId: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const h = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [open]);

	const current = sites.find((s) => s.id === currentSiteId);

	return (
		<div ref={ref} className="site-switcher">
			<button type="button" className="site-switcher-btn" onClick={() => setOpen((v) => !v)}>
				<span>{current?.name || t("sites.all_sites")}</span>
				<span style={{ fontSize: 9 }}>{open ? "▲" : "▼"}</span>
			</button>
			{open && (
				<div className="site-switcher-dropdown">
					<button type="button"
						className="site-switcher-item"
						onClick={() => {
							onNavigate(null);
							setOpen(false);
						}}
					>
						← {t("sites.all_sites")}
					</button>
					{sites.map((s) => (
						<button type="button"
							key={s.id}
							className={`site-switcher-item ${s.id === currentSiteId ? "active" : ""}`}
							onClick={() => {
								onNavigate(s.id);
								setOpen(false);
							}}
						>
							<span>{s.name}</span>
							{s.id === currentSiteId && (
								<span style={{ fontSize: 10, color: "var(--accent)" }}>✓</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function NavMenu({
	navigate,
	queryClient,
}: {
	navigate: ReturnType<typeof useNavigate>;
	queryClient: ReturnType<typeof useQueryClient>;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const h = (e: MouseEvent | TouchEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		document.addEventListener("mousedown", h);
		document.addEventListener("touchstart", h);
		return () => {
			document.removeEventListener("mousedown", h);
			document.removeEventListener("touchstart", h);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [open]);

	const go = (to: string) => {
		navigate({ to });
		setOpen(false);
	};
	const doLogout = () => {
		logout();
		queryClient.clear();
		navigate({ to: "/login" });
	};

	const items = [
		{ label: "Profile", to: "/profile" },
		{ label: "Affiliate", to: "/affiliate" },
		{ label: "Settings", to: "/settings" },
		{ label: "API Playground", to: "/settings/api-playground" },
		{ label: "API Tokens", to: "/settings/api-tokens" },
	];

	return (
		<div ref={ref} className="nav-menu-wrap">
			{/* Desktop: show all items inline */}
			<div className="nav-menu-desktop">
				{items.map((item) => (
					<button type="button"
						key={item.to}
						className="btn-pill"
						onClick={() => go(item.to)}
					>
						{item.label}
					</button>
				))}
				<button type="button" className="btn-pill" onClick={doLogout}>
					{t("nav.logout")}
				</button>
			</div>
			{/* Mobile: hamburger + dropdown */}
			<button type="button"
				className="nav-menu-btn"
				onClick={() => setOpen((v) => !v)}
				aria-label="Menu"
				aria-expanded={open}
			>
				<span className={`nav-menu-icon ${open ? "open" : ""}`} />
			</button>
			{open && (
				<div className="nav-menu-dropdown" role="menu">
					{items.map((item) => (
						<button type="button"
							key={item.to}
							className="nav-menu-item"
							role="menuitem"
							onClick={() => go(item.to)}
						>
							{item.label}
						</button>
					))}
					<div className="nav-menu-sep" />
					<button type="button"
						className="nav-menu-item nav-menu-logout"
						role="menuitem"
						onClick={doLogout}
					>
						{t("nav.logout")}
					</button>
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
	const isAuthPage =
		location.pathname === "/login" || location.pathname === "/register";
	const isDemoPage = location.pathname === "/demo";
	const isPaywallPage = location.pathname === "/paywall";

	// ALL hooks must be called unconditionally (Rules of Hooks)
	const { data: subscription } = useQuery<Subscription>({
		queryKey: ["subscription"],
		queryFn: fetchSubscription,
		enabled: authenticated && !isAuthPage,
		staleTime: 5 * 60 * 1000,
	});

	useEffect(() => {
		initPushNotifications();
	}, []);

	const [moreOpen, setMoreOpen] = useState(false);
	const moreRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!moreOpen) return;
		const h = (e: MouseEvent | TouchEvent) => {
			if (moreRef.current && !moreRef.current.contains(e.target as Node))
				setMoreOpen(false);
		};
		document.addEventListener("mousedown", h);
		document.addEventListener("touchstart", h);
		return () => {
			document.removeEventListener("mousedown", h);
			document.removeEventListener("touchstart", h);
		};
	}, [moreOpen]);

	useEffect(() => {
		if (!moreOpen) return;
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") setMoreOpen(false);
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [moreOpen]);

	const { data: sites } = useQuery({
		queryKey: ["sites"],
		queryFn: () => fetchSites(),
		enabled: authenticated && !isAuthPage,
	});

	const routeState = useRouterState({ select: (s) => s.location });
	const siteMatch = routeState.pathname.match(/^\/site\/([^/]+)/);
	const siteId = siteMatch ? siteMatch[1]! : null;
	const pathname = routeState.pathname;

	// Handle Google OAuth callback token from URL fragment
	useEffect(() => {
		const hash = window.location.hash;
		const tm = hash.match(/token=([^&]+)/);
		if (tm?.[1]) {
			const token = decodeURIComponent(tm[1]!);
			setItem("kp_token", token).then(async () => {
				try {
					const API_BASE =
						import.meta.env.VITE_API_BASE ||
						(import.meta.env.DEV ? "http://localhost:3000/api" : "/api");
					const res = await fetch(`${API_BASE}/auth/me`, {
						headers: { Authorization: `Bearer ${token}` },
					});
					const json = await res.json();
					if (json.success && json.data?.user) {
						await setItem("kp_user", JSON.stringify(json.data.user));
					}
				} catch {
					/* non-critical — user can still use the app */
				}
				window.history.replaceState(
					null,
					"",
					window.location.pathname + window.location.search,
				);
				queryClient.invalidateQueries({ queryKey: ["subscription"] });
				queryClient.invalidateQueries({ queryKey: ["sites"] });
				navigate({ to: "/" });
			});
		}
	}, [queryClient.invalidateQueries, navigate]);

	// Auth gate
	useEffect(() => {
		if (!authenticated && !isAuthPage && !isDemoPage) {
			const timer = setTimeout(() => navigate({ to: "/login" }), 0);
			return () => clearTimeout(timer);
		}
	}, [authenticated, isAuthPage, isDemoPage, navigate]);

	// Subscription gate — all hooks MUST be before early returns (Rules of Hooks)
	const currentUser = getCurrentUser();
	const isSuperAdmin = currentUser?.role === "super_admin";
	const hasSubData = subscription !== undefined;
	const isPaidActive =
		subscription &&
		subscription.plan !== "micro" &&
		(subscription.status === "active" || subscription.status === "trialing");

	const [paywallRedirect, setPaywallRedirect] = useState(false);
	useEffect(() => {
		if (!authenticated) return;
		if (isSuperAdmin) return;
		if (isPaywallPage) return;
		if (!hasSubData) return;
		if (!isPaidActive) {
			setPaywallRedirect(true);
			if (location.pathname !== "/paywall") {
				const timer = setTimeout(() => navigate({ to: "/paywall" }), 0);
				return () => clearTimeout(timer);
			}
		}
	}, [
		authenticated,
		isSuperAdmin,
		isPaywallPage,
		hasSubData,
		isPaidActive,
		navigate,
		location.pathname,
	]);

	useEffect(() => {
		if (!authenticated) return;
		if (!isPaywallPage) return;
		if (!hasSubData) return;
		if (isSuperAdmin || isPaidActive) {
			if (location.pathname !== "/") {
				const timer = setTimeout(() => navigate({ to: "/" }), 0);
				return () => clearTimeout(timer);
			}
		}
	}, [
		authenticated,
		isPaywallPage,
		hasSubData,
		isSuperAdmin,
		isPaidActive,
		navigate,
		location.pathname,
	]);

	// Early returns for conditional rendering — no hooks below this line
	if (isDemoPage)
		return (
			<div style={{ height: "100vh" }}>
				<Outlet />
			</div>
		);
	if (isAuthPage)
		return (
			<div style={{ height: "100vh" }}>
				<Outlet />
			</div>
		);
	if (!authenticated) {
		return (
			<div
				style={{
					height: "100vh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div className="spinner" />
			</div>
		);
	}

	if (!isSuperAdmin && !isPaywallPage && !hasSubData) {
		return (
			<div
				style={{
					height: "100vh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div className="spinner" />
			</div>
		);
	}

	if (!isSuperAdmin && !isPaywallPage && !isPaidActive && paywallRedirect) {
		return null;
	}

	const sitesList = sites ?? [];

	const showTrial =
		!isSuperAdmin &&
		!isPaywallPage &&
		subscription?.status === "trialing" &&
		(subscription.trial_days_remaining ?? 0) > 0;

	const bottomNavItems = [
		{ key: "home", label: "Sites", to: "/" },
		{ key: "settings", label: "Settings", to: "/settings" },
		{ key: "profile", label: "Profile", to: "/profile" },
		{ key: "more", label: "More", to: "#more" },
	] as const;

	const isActive = (key: string, to: string) => {
		if (key === "home") return pathname === "/";
		if (key === "more") return false;
		return pathname.startsWith(to);
	};

	return (
		<div
			style={{
				height: "100vh",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<header className="topnav">
				<div className="topnav-left">
					<button type="button" className="topnav-logo" onClick={() => navigate({ to: "/" })}>
						<img src="/revklik.webp" alt="" className="topnav-logo-icon" />
						<span className="topnav-logo-text">RevKlik</span>
					</button>
					{sitesList.length > 0 && pathname !== "/" && (
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
					<button type="button"
						className="btn-pill topnav-lang"
						onClick={() => {
							toggleLang();
							window.location.reload();
						}}
					>
						{getLang() === "en" ? "ID" : "EN"}
					</button>
					<button type="button"
						className="btn-pill topnav-profile"
						aria-label="Profile"
						onClick={() => navigate({ to: "/profile" })}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						 aria-hidden="true">
							<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
							<circle cx="12" cy="7" r="4" />
						</svg>
					</button>
					<NavMenu navigate={navigate} queryClient={queryClient} />
				</div>
			</header>
			{showTrial && (
				<TrialBanner
					days={subscription?.trial_days_remaining ?? 0}
					onUpgrade={() => navigate({ to: "/paywall" })}
				/>
			)}
			<TooltipProvider delayDuration={200}>
				<main
					style={{
						flex: 1,
						overflow: "auto",
						display: "flex",
						flexDirection: "column",
					}}
				>
					<Outlet />
				</main>
			</TooltipProvider>

			{!isPaywallPage && (
				<nav className="bottom-nav" aria-label="Mobile navigation">
					{bottomNavItems.map((item) => {
						const active = isActive(item.key, item.to);
						if (item.key === "more") {
							return (
								<button type="button"
									key={item.key}
									className={`bottom-nav-item ${moreOpen ? "active" : ""}`}
									onClick={() => setMoreOpen(!moreOpen)}
									aria-expanded={moreOpen}
									aria-haspopup="true"
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									 aria-hidden="true">
										<circle cx="12" cy="5" r="1" />
										<circle cx="12" cy="12" r="1" />
										<circle cx="12" cy="19" r="1" />
									</svg>
									<span>{item.label}</span>
								</button>
							);
						}
						return (
							<button type="button"
								key={item.key}
								className={`bottom-nav-item ${active ? "active" : ""}`}
								onClick={() => navigate({ to: item.to })}
							>
								{item.key === "home" && (
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									 aria-hidden="true">
										<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
										<polyline points="9 22 9 12 15 12 15 22" />
									</svg>
								)}
								{item.key === "settings" && (
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									 aria-hidden="true">
										<circle cx="12" cy="12" r="3" />
										<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
									</svg>
								)}
								{item.key === "profile" && (
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									 aria-hidden="true">
										<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
										<circle cx="12" cy="7" r="4" />
									</svg>
								)}
								<span>{item.label}</span>
							</button>
						);
					})}
				</nav>
			)}
			{moreOpen && !isPaywallPage && (
				<div
					className="bottom-nav-more"
					ref={moreRef}
					role="dialog"
					aria-modal="true"
					aria-label="More navigation"
				>
					<button type="button"
						onClick={() => {
							navigate({ to: "/affiliate" });
							setMoreOpen(false);
						}}
					>
						Affiliate
					</button>
					<button type="button"
						onClick={() => {
							navigate({ to: "/settings/api-tokens" });
							setMoreOpen(false);
						}}
					>
						API Tokens
					</button>
					<button type="button"
						onClick={() => {
							navigate({ to: "/settings/api-playground" });
							setMoreOpen(false);
						}}
					>
						API Playground
					</button>
					<button type="button"
						onClick={() => {
							navigate({ to: "/docs/install" });
							setMoreOpen(false);
						}}
					>
						Install Guide
					</button>
					<button type="button"
						onClick={() => {
							navigate({ to: "/import" });
							setMoreOpen(false);
						}}
					>
						Import
					</button>
					<div className="bottom-nav-more-sep" />
					<button type="button"
						className="bottom-nav-more-logout"
						onClick={() => {
							logout();
							queryClient.clear();
							navigate({ to: "/login" });
						}}
					>
						Log out
					</button>
				</div>
			)}

			<ToastContainer />
		</div>
	);
}

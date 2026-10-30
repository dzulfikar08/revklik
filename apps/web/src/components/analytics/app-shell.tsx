import { BrandMark } from "@revklik/ui/components/brand-mark";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { Link } from "@tanstack/react-router";
import { ChartColumn, Code2, Home, LayoutGrid, Plus, Settings, Share2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { LocaleToggle } from "@/components/locale-toggle";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

import { AccountMenu } from "./account-menu";
import { fmt } from "./data";

/** Where the nav item lands: a section of one site, or a page of its own. */
export type NavKey = "sites" | "overview" | "portfolio" | "connect" | "share" | "settings";

interface NavItem {
	key: NavKey;
	Icon: LucideIcon;
	label: MessageKey;
}

const SITE_NAV: readonly NavItem[] = [
	{ Icon: Home, key: "overview", label: "nav.overview" },
	{ Icon: ChartColumn, key: "portfolio", label: "nav.portfolio" },
	{ Icon: Code2, key: "connect", label: "nav.connect" },
	{ Icon: Share2, key: "share", label: "nav.share" },
	{ Icon: Settings, key: "settings", label: "nav.settings" },
];

const ACCOUNT_NAV: readonly NavItem[] = [
	{ Icon: LayoutGrid, key: "sites", label: "nav.sites" },
	{ Icon: ChartColumn, key: "portfolio", label: "nav.portfolio" },
];

const SECTION_VIEW = {
	connect: "integrations",
	settings: "settings",
	share: "share",
} as const;

const NavTarget = ({
	item,
	siteId,
	active,
	className,
	children,
}: {
	item: NavItem;
	siteId: string | undefined;
	active: boolean;
	className: string;
	children: ReactNode;
}) => {
	const current = active ? ("page" as const) : undefined;
	if (item.key === "portfolio") {
		return (
			<Link to="/analytics/portfolio" aria-current={current} className={className}>
				{children}
			</Link>
		);
	}
	if (item.key === "sites" || !siteId) {
		return (
			<Link to="/analytics" aria-current={current} className={className}>
				{children}
			</Link>
		);
	}
	return (
		<Link
			to="/analytics/$siteId"
			params={{ siteId }}
			search={
				item.key === "overview" ? {} : { view: SECTION_VIEW[item.key as keyof typeof SECTION_VIEW] }
			}
			aria-current={current}
			className={className}
		>
			{children}
		</Link>
	);
};

const navItems = (siteId: string | undefined): readonly NavItem[] =>
	siteId ? SITE_NAV : ACCOUNT_NAV;

const DesktopNav = ({ active, siteId }: { active: NavKey | null; siteId: string | undefined }) => {
	const t = useT();
	return (
		<nav aria-label={t("nav.label")} className="hidden items-center gap-1 lg:flex">
			{navItems(siteId).map((item) => (
				<NavTarget
					key={item.key}
					item={item}
					siteId={siteId}
					active={active === item.key}
					className={`focus-visible:outline-ring flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-offset-2 transition-colors duration-150 focus-visible:outline-2 ${
						active === item.key
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
					}`}
				>
					<item.Icon className="size-4" aria-hidden />
					{t(item.label)}
				</NavTarget>
			))}
		</nav>
	);
};

const BottomNav = ({ active, siteId }: { active: NavKey | null; siteId: string | undefined }) => {
	const t = useT();
	return (
		<nav
			aria-label={t("nav.label")}
			className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
		>
			<ul className="mx-auto flex max-w-xl">
				{navItems(siteId).map((item) => (
					<li key={item.key} className="min-w-0 flex-1">
						<NavTarget
							item={item}
							siteId={siteId}
							active={active === item.key}
							className={`focus-visible:outline-ring flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium outline-offset-[-2px] focus-visible:outline-2 ${
								active === item.key ? "text-foreground" : "text-muted-foreground"
							}`}
						>
							<item.Icon
								className={`size-5 ${active === item.key ? "text-(--chart)" : ""}`}
								aria-hidden
							/>
							<span className="max-w-full truncate">{t(item.label)}</span>
						</NavTarget>
					</li>
				))}
			</ul>
		</nav>
	);
};

/**
 * Live visitor count. The dot marks a real live state, so it stays, but
 * static: the theme's MOTION 1 dial allows no endless pulse.
 */
export const OnlinePill = ({ online }: { online: number | null }) => {
	const t = useT();
	return (
		<span
			className="bg-card ring-foreground/10 flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] whitespace-nowrap tabular-nums ring-1"
			title={t("hdr.online")}
		>
			<span className="size-2 rounded-full bg-(--up)" aria-hidden />
			<span>{online === null ? "…" : fmt(online)}</span>
			<span className="max-sm:sr-only">{t("hdr.online")}</span>
		</span>
	);
};

const MANAGE_SITES = "__manage";

export interface SitePickerProps {
	sites: { id: string; domain: string }[];
	siteId: string;
	loading: boolean;
	onPick: (id: string) => void;
	onManage: () => void;
}

const SitePicker = ({ sites, siteId, loading, onPick, onManage }: SitePickerProps) => {
	const t = useT();
	const placeholder = loading ? t("hdr.loadingSite") : t("hdr.site");
	return (
		<Select
			value={siteId}
			onValueChange={(v) => {
				if (v === MANAGE_SITES) {
					onManage();
					return;
				}
				onPick(String(v));
			}}
		>
			<SelectTrigger
				aria-label={t("hdr.site")}
				className="bg-card ring-foreground/10 focus-visible:outline-ring data-[placeholder]:text-foreground hover:bg-accent dark:bg-card dark:hover:bg-accent pointer-coarse:min-h-11 h-auto min-h-9 w-auto max-w-full min-w-0 flex-1 justify-start gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 sm:max-w-72 sm:flex-none"
			>
				<span className="size-2 shrink-0 rounded-full bg-(--chart)" aria-hidden />
				<SelectValue placeholder={placeholder}>
					<span className="block truncate">
						{sites.find((s) => s.id === siteId)?.domain ?? placeholder}
					</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="start" className="min-w-52">
				{sites.map((s) => (
					<SelectItem key={s.id} value={s.id} className="pointer-coarse:min-h-11 text-[13px]">
						{s.domain}
					</SelectItem>
				))}
				<SelectSeparator />
				<SelectItem value={MANAGE_SITES} className="pointer-coarse:min-h-11 text-[13px]">
					<span className="flex items-center gap-1.5">
						<Plus className="size-3.5" aria-hidden />
						{t("hdr.manageSites")}
					</span>
				</SelectItem>
			</SelectContent>
		</Select>
	);
};

/**
 * Shared chrome for every signed-in page: one sticky header row (brand, site
 * picker, live count, account), inline nav from lg, and a bottom nav below lg
 * so phones keep one slim header and thumb-reach navigation.
 */
export const AppShell = ({
	active,
	siteId,
	picker,
	online,
	onLinkAccount,
	onAdmin,
	children,
}: {
	active: NavKey | null;
	/** Site the per-site nav items point at; omitted until the owner has opened one. */
	siteId?: string;
	/** Site switcher; only pages that sit inside a site pass it. */
	picker?: SitePickerProps;
	online?: number | null;
	onLinkAccount?: () => void;
	onAdmin?: () => void;
	children: ReactNode;
}) => {
	const t = useT();
	return (
		<div className="bg-background text-foreground min-h-svh pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
			<header className="border-border/60 bg-background/90 sticky top-0 z-20 border-b backdrop-blur">
				<div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 md:px-4">
					<Link
						to="/analytics"
						aria-label={t("hdr.allSites")}
						title={t("hdr.allSites")}
						className="hover:bg-accent focus-visible:outline-ring pointer-coarse:size-11 -ms-1 flex size-9 shrink-0 items-center justify-center gap-2.5 rounded-lg outline-offset-2 transition-colors sm:w-auto sm:px-1.5 sm:pe-2"
					>
						<BrandMark className="h-5 w-auto" />
						<span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
							RevKlik
						</span>
					</Link>
					{picker ? <SitePicker {...picker} /> : null}
					<DesktopNav active={active} siteId={siteId} />
					<div className="ms-auto flex shrink-0 items-center gap-2">
						{online === undefined ? null : <OnlinePill online={online} />}
						<div className="hidden lg:block">
							<LocaleToggle />
						</div>
						<AccountMenu onLinkAccount={onLinkAccount} onAdmin={onAdmin} />
					</div>
				</div>
			</header>
			{children}
			<BottomNav active={active} siteId={siteId} />
		</div>
	);
};

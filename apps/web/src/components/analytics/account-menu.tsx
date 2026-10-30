import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@revklik/ui/components/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CreditCard, Languages, LogOut, ShieldCheck, SunMoon, UserPlus } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";

import { openBilling } from "@/lib/billing-nav";
import { isSelfHosted } from "@/lib/instance-config";
import { setLocale, useLocale, useT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import {
	enterDashboard,
	fetchLinks,
	LINKS_QUERY_KEY,
	rememberedOtherUserIds,
	switchAccount,
} from "@/lib/legacy/accounts";
import type { LinkedUser } from "@/lib/legacy/accounts";
import { getLegacyUser, legacySignOut } from "@/lib/legacy/api";

import { AccountAvatar } from "./account-avatar";

const THEMES = ["system", "light", "dark"] as const;
type ThemeChoice = (typeof THEMES)[number];

const isThemeChoice = (value: string | undefined): value is ThemeChoice =>
	THEMES.some((choice) => choice === value);

const LOCALES: { value: Locale; name: string }[] = [
	{ name: "Bahasa Indonesia", value: "id" },
	{ name: "English", value: "en" },
];

/**
 * Avatar menu in the dashboard header: current account, one-tap switching to
 * linked accounts, billing, language and theme, a shortcut to link another
 * account, and sign out of this account. Language and theme live here so they
 * are one tap away on every page, inside a site too.
 */
export const AccountMenu = ({
	onLinkAccount,
	onAdmin,
	className = "",
}: {
	/** Omitted where no settings page is reachable (an account with no sites yet). */
	onLinkAccount?: () => void;
	/** Super admins only; omitted where no admin view is reachable. */
	onAdmin?: () => void;
	className?: string;
}) => {
	const t = useT();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const me = getLegacyUser();
	const locale = useLocale();
	const { theme, setTheme } = useTheme();
	const [keepOthers, setKeepOthers] = useState(false);
	const links = useQuery({
		enabled: Boolean(me),
		queryFn: fetchLinks,
		queryKey: LINKS_QUERY_KEY,
		staleTime: 30_000,
	});

	if (!me) {
		return null;
	}

	const switchTo = async (target: LinkedUser): Promise<void> => {
		try {
			await switchAccount(target);
			queryClient.clear();
			enterDashboard();
		} catch {
			toast.error(t("accounts.switchError"));
		}
	};

	const signOut = async (): Promise<void> => {
		await legacySignOut({ keepOthers });
		queryClient.clear();
		await navigate({ to: "/login" });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={t("accounts.menu.label")}
				title={me.email}
				className={`focus-visible:outline-ring flex shrink-0 items-center justify-center rounded-full outline-offset-2 focus-visible:outline-2 ${className}`}
			>
				<AccountAvatar name={me.name} email={me.email} className="size-8 pointer-coarse:size-11" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="bg-card w-72 max-w-[calc(100vw-1.5rem)]">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{t("accounts.menu.signedInAs")}</DropdownMenuLabel>
					<div className="flex items-center gap-2.5 px-2 pb-2">
						<AccountAvatar name={me.name} email={me.email} />
						<span className="min-w-0">
							<span className="block truncate text-[13px] font-medium">{me.name}</span>
							<span className="text-muted-foreground block truncate font-mono text-[11px]">
								{me.email}
							</span>
						</span>
					</div>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>{t("accounts.title")}</DropdownMenuLabel>
					{links.isLoading ? (
						<p className="text-muted-foreground px-2 py-1.5 text-xs" role="status">
							{t("accounts.loading")}
						</p>
					) : null}
					{links.isError ? (
						<div className="flex items-center justify-between gap-2 px-2 py-1.5">
							<span className="text-destructive text-xs" role="alert">
								{t("accounts.loadError")}
							</span>
							<button
								type="button"
								onClick={() => void links.refetch()}
								className="text-foreground focus-visible:outline-ring rounded-sm text-xs underline underline-offset-2 outline-offset-2 focus-visible:outline-2"
							>
								{t("accounts.retry")}
							</button>
						</div>
					) : null}
					{links.data?.length === 0 ? (
						<p className="text-muted-foreground px-2 py-1.5 text-xs">
							{t("accounts.menu.noLinks")}
						</p>
					) : null}
					{links.data?.map((link) => (
						<DropdownMenuItem
							key={link.id}
							aria-label={t("accounts.menu.switchTo", { name: link.user.name })}
							onClick={() => void switchTo(link.user)}
							className="gap-2.5 py-2 pointer-coarse:min-h-11"
						>
							<AccountAvatar name={link.user.name} email={link.user.email} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13px] font-medium">{link.user.name}</span>
								<span className="text-muted-foreground block truncate font-mono text-[11px]">
									{link.user.email}
								</span>
							</span>
							<span className="text-muted-foreground text-xs">{t("accounts.switch")}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				{onLinkAccount ? (
					<DropdownMenuItem onClick={onLinkAccount} className="pointer-coarse:min-h-11">
						<UserPlus className="size-3.5" aria-hidden />
						{t("accounts.menu.link")}
					</DropdownMenuItem>
				) : null}
				{isSelfHosted() ? null : (
					<DropdownMenuItem onClick={() => openBilling()} className="pointer-coarse:min-h-11">
						<CreditCard className="size-3.5" aria-hidden />
						{t("menu.billing")}
					</DropdownMenuItem>
				)}
				{onAdmin && me.role === "super_admin" ? (
					<DropdownMenuItem onClick={onAdmin} className="pointer-coarse:min-h-11">
						<ShieldCheck className="size-3.5" aria-hidden />
						{t("menu.admin")}
					</DropdownMenuItem>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="pointer-coarse:min-h-11">
						<Languages className="size-3.5" aria-hidden />
						{t("locale.label")}
						<span className="text-muted-foreground ms-auto me-1 text-xs">
							{locale === "id" ? "ID" : "EN"}
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="bg-card">
						<DropdownMenuRadioGroup
							value={locale}
							onValueChange={(value) => setLocale(value === "id" ? "id" : "en")}
						>
							{LOCALES.map((option) => (
								<DropdownMenuRadioItem
									key={option.value}
									value={option.value}
									lang={option.value}
									className="pointer-coarse:min-h-11"
								>
									{option.name}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="pointer-coarse:min-h-11">
						<SunMoon className="size-3.5" aria-hidden />
						{t("theme.label")}
						<span className="text-muted-foreground ms-auto me-1 text-xs">
							{t(`theme.${isThemeChoice(theme) ? theme : "system"}`)}
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="bg-card">
						<DropdownMenuRadioGroup
							value={isThemeChoice(theme) ? theme : "system"}
							onValueChange={setTheme}
						>
							{THEMES.map((choice) => (
								<DropdownMenuRadioItem
									key={choice}
									value={choice}
									className="pointer-coarse:min-h-11"
								>
									{t(`theme.${choice}`)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				{rememberedOtherUserIds().length > 0 ? (
					<DropdownMenuCheckboxItem
						checked={keepOthers}
						closeOnClick={false}
						onCheckedChange={setKeepOthers}
						className="pointer-coarse:min-h-11 whitespace-normal"
					>
						{t("accounts.keepOthers")}
					</DropdownMenuCheckboxItem>
				) : null}
				<DropdownMenuItem
					variant="destructive"
					onClick={() => void signOut()}
					className="pointer-coarse:min-h-11"
				>
					<LogOut className="size-3.5" aria-hidden />
					{t("accounts.menu.signOut")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

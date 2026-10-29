import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@revklik/ui/components/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import { enterDashboard, fetchLinks, LINKS_QUERY_KEY, switchAccount } from "@/lib/legacy/accounts";
import type { LinkedUser } from "@/lib/legacy/accounts";
import { getLegacyUser, legacySignOut } from "@/lib/legacy/api";

import { AccountAvatar } from "./account-avatar";

/**
 * Avatar menu in the dashboard header: current account, one-tap switching to
 * linked accounts, a shortcut to link another, and sign out of this account.
 */
export const AccountMenu = ({
	onLinkAccount,
	className = "",
}: {
	/** Omitted where no settings page is reachable (an account with no sites yet). */
	onLinkAccount?: () => void;
	className?: string;
}) => {
	const t = useT();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const me = getLegacyUser();
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
		await legacySignOut();
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
				<AccountAvatar
					name={me.name}
					email={me.email}
					className="size-8 pointer-coarse:size-11 sm:pointer-coarse:size-9"
				/>
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

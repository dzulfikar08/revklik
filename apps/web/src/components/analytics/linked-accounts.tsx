/**
 * Linked accounts, Settings section: accounts you proved you own (password
 * or Google) and can switch between from any device. Routes: GET/POST
 * /auth/links, DELETE /auth/links/:id, POST /auth/switch.
 */
import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Unlink } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { GoogleIcon } from "@/components/google-icon";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import {
	completeGoogleLink,
	enterDashboard,
	fetchLinks,
	LINKS_QUERY_KEY,
	linkWithPassword,
	MAX_LINKS,
	previewGoogleLink,
	startGoogleLink,
	switchAccount,
	unlinkAccount,
} from "@/lib/legacy/accounts";
import type { AccountLink, LinkedUser } from "@/lib/legacy/accounts";
import { LegacyApiError } from "@/lib/legacy/api";
import { useModalDialog } from "@/lib/use-modal-dialog";

import { AccountAvatar } from "./account-avatar";
import { Panel } from "./ui";

const LINK_ERROR_KEYS: Record<string, MessageKey> = {
	already_linked: "accounts.err.already",
	current_password_invalid: "accounts.err.currentInvalid",
	recent_login_required: "accounts.err.recent",
	unverified: "accounts.err.unverified",
	expired: "accounts.err.expired",
	invalid_credentials: "accounts.err.invalid",
	limit_reached: "accounts.err.limit",
	no_account: "accounts.err.noAccount",
	self: "accounts.err.self",
	too_many_attempts: "accounts.err.throttled",
};

const linkErrorKey = (code: string | undefined): MessageKey =>
	(code ? LINK_ERROR_KEYS[code] : undefined) ?? "accounts.err.generic";

const codeOf = (err: unknown): string | undefined =>
	err instanceof LegacyApiError ? err.code : undefined;

const ConfirmDialog = ({
	title,
	body,
	confirmLabel,
	destructive,
	pending,
	onConfirm,
	onClose,
}: {
	title: string;
	body: string;
	confirmLabel: string;
	destructive: boolean;
	pending: boolean;
	onConfirm: () => void;
	onClose: () => void;
}) => {
	const t = useT();
	const dialog = useModalDialog<HTMLDivElement>(onClose);
	const titleId = useId();
	const bodyId = useId();
	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center p-3">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden
				onClick={onClose}
				className="animate-in fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
			/>
			<div
				ref={dialog.ref}
				onKeyDown={dialog.onKeyDown}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={bodyId}
				tabIndex={-1}
				className="bg-card ring-foreground/10 animate-in fade-in zoom-in-95 relative w-full max-w-sm rounded-2xl p-4 ring-1 duration-150 outline-none"
			>
				<h2 id={titleId} className="text-sm font-semibold">
					{title}
				</h2>
				<p id={bodyId} className="text-muted-foreground mt-1.5 text-xs">
					{body}
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<Button
						variant="outline"
						className="pointer-coarse:h-11 h-8"
						onClick={onClose}
						data-autofocus
					>
						{t("accounts.cancel")}
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						className="pointer-coarse:h-11 h-8"
						disabled={pending}
						onClick={onConfirm}
					>
						{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
						{confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
};

const LINK_CODE_KEY = "kp_link_code";

export const LinkedAccountsSection = () => {
	const t = useT();
	const queryClient = useQueryClient();
	const formId = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<AccountLink | null>(null);
	const [switchingId, setSwitchingId] = useState<string | null>(null);
	const [googlePending, setGooglePending] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");
	// Google handed back a code: show which account it is before anything is linked.
	const [pendingGoogle, setPendingGoogle] = useState<{ code: string; user: LinkedUser } | null>(
		null,
	);

	const linksQ = useQuery({ queryFn: fetchLinks, queryKey: LINKS_QUERY_KEY, staleTime: 15_000 });

	// A failed Google link returns here with ?link=error&reason=…; success carries a #link_code instead.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const result = params.get("link");
		if (result !== "error") {
			return;
		}
		const reason = params.get("reason") ?? undefined;
		params.delete("link");
		params.delete("reason");
		const query = params.toString();
		window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
		toast.error(t(linkErrorKey(reason), { n: MAX_LINKS }));
	}, [t]);

	useEffect(() => {
		const code = sessionStorage.getItem(LINK_CODE_KEY);
		if (!code) {
			return;
		}
		sessionStorage.removeItem(LINK_CODE_KEY);
		previewGoogleLink(code)
			.then((user) => setPendingGoogle({ code, user }))
			.catch(() => toast.error(t("accounts.err.expired")));
	}, [t]);

	const completeGoogleMut = useMutation({
		mutationFn: (code: string) => completeGoogleLink(code),
		onError: (err) => toast.error(t(linkErrorKey(codeOf(err)), { n: MAX_LINKS })),
		onSettled: () => setPendingGoogle(null),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: LINKS_QUERY_KEY });
			toast.success(t("accounts.googleLinked"));
		},
	});

	const linkMut = useMutation({
		mutationFn: () => linkWithPassword(email.trim(), password, currentPassword),
		onError: (err) => setFormError(t(linkErrorKey(codeOf(err)), { n: MAX_LINKS })),
		onSuccess: (link) => {
			setFormError(null);
			setEmail("");
			setPassword("");
			setCurrentPassword("");
			void queryClient.invalidateQueries({ queryKey: LINKS_QUERY_KEY });
			toast.success(t("accounts.linked", { name: link.user.name }));
		},
	});

	const unlinkMut = useMutation({
		mutationFn: (link: AccountLink) => unlinkAccount(link),
		onError: () => toast.error(t("accounts.unlinkError")),
		onSettled: () => setConfirming(null),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: LINKS_QUERY_KEY });
			toast.success(t("accounts.unlinked"));
		},
	});

	const switchTo = async (link: AccountLink): Promise<void> => {
		setSwitchingId(link.id);
		try {
			await switchAccount(link.user);
			queryClient.clear();
			enterDashboard();
		} catch {
			setSwitchingId(null);
			toast.error(t("accounts.switchError"));
		}
	};

	const linkWithGoogle = async (): Promise<void> => {
		setGooglePending(true);
		try {
			await startGoogleLink(
				`${window.location.origin}${window.location.pathname}?view=settings`,
				currentPassword,
			);
		} catch (err) {
			setGooglePending(false);
			toast.error(t(linkErrorKey(codeOf(err)), { n: MAX_LINKS }));
		}
	};

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		if (linkMut.isPending) {
			return;
		}
		setFormError(null);
		linkMut.mutate();
	};

	const links = linksQ.data ?? [];

	return (
		<Panel title={t("accounts.title")} hint={t("accounts.hint")}>
			{linksQ.isLoading ? (
				<p className="text-muted-foreground flex items-center gap-2 py-3 text-xs" role="status">
					<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
					{t("accounts.loading")}
				</p>
			) : null}
			{linksQ.isError ? (
				<div className="flex flex-wrap items-center gap-2 py-2" role="alert">
					<span className="text-destructive text-xs">{t("accounts.loadError")}</span>
					<Button
						variant="outline"
						className="pointer-coarse:h-11 h-8 text-xs"
						onClick={() => void linksQ.refetch()}
					>
						{t("accounts.retry")}
					</Button>
				</div>
			) : null}
			{linksQ.isSuccess && links.length === 0 ? (
				<p className="text-muted-foreground py-2 text-xs">{t("accounts.empty")}</p>
			) : null}
			{links.length > 0 ? (
				<ul className="mb-3 grid gap-1.5">
					{links.map((link) => (
						<li
							key={link.id}
							className="bg-muted/40 flex items-center gap-2.5 rounded-lg px-2.5 py-2"
						>
							<AccountAvatar name={link.user.name} email={link.user.email} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13px] font-medium">{link.user.name}</span>
								<span className="text-muted-foreground block truncate font-mono text-[11px]">
									{link.user.email}
								</span>
							</span>
							<Button
								variant="outline"
								className="pointer-coarse:h-11 h-8 text-xs"
								disabled={switchingId !== null}
								onClick={() => void switchTo(link)}
							>
								{switchingId === link.id ? (
									<LoaderCircle className="animate-spin" aria-hidden />
								) : null}
								{switchingId === link.id ? t("accounts.switching") : t("accounts.switch")}
							</Button>
							<button
								type="button"
								aria-label={t("accounts.unlinkAria", { name: link.user.name })}
								title={t("accounts.unlink")}
								onClick={() => setConfirming(link)}
								className="text-muted-foreground hover:text-(--down) focus-visible:outline-ring flex size-8 items-center justify-center rounded-md outline-offset-2 focus-visible:outline-2 pointer-coarse:size-11"
							>
								<Unlink className="size-3.5" aria-hidden />
							</button>
						</li>
					))}
				</ul>
			) : null}

			<div className="border-border/60 border-t pt-3">
				<h3 className="text-[13px] font-semibold">{t("accounts.linkTitle")}</h3>
				<p className="text-muted-foreground mt-0.5 mb-2.5 text-xs">{t("accounts.linkDesc")}</p>
				<form onSubmit={submit} className="grid gap-2.5 sm:max-w-sm">
					<div className="grid gap-1.5">
						<Label htmlFor={`${formId}-email`} className="text-xs">
							{t("accounts.email")}
						</Label>
						<Input
							id={`${formId}-email`}
							type="email"
							autoComplete="off"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							className="pointer-coarse:h-11 h-9"
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor={`${formId}-password`} className="text-xs">
							{t("accounts.password")}
						</Label>
						<Input
							id={`${formId}-password`}
							type="password"
							autoComplete="off"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className="pointer-coarse:h-11 h-9"
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor={`${formId}-current`} className="text-xs">
							{t("accounts.currentPassword")}
						</Label>
						<Input
							id={`${formId}-current`}
							type="password"
							autoComplete="current-password"
							value={currentPassword}
							onChange={(e) => setCurrentPassword(e.target.value)}
							aria-describedby={`${formId}-current-hint`}
							className="pointer-coarse:h-11 h-9"
						/>
						<p id={`${formId}-current-hint`} className="text-muted-foreground text-[11px]">
							{t("accounts.currentPasswordHint")}
						</p>
					</div>
					{formError ? (
						<p className="text-destructive text-xs" role="alert">
							{formError}
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" className="pointer-coarse:h-11 h-9" disabled={linkMut.isPending}>
							{linkMut.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
							{linkMut.isPending ? t("accounts.linking") : t("accounts.linkBtn")}
						</Button>
						<Button
							type="button"
							variant="outline"
							className="pointer-coarse:h-11 h-9 gap-2"
							disabled={googlePending}
							onClick={() => void linkWithGoogle()}
						>
							<GoogleIcon />
							{t("accounts.google")}
						</Button>
					</div>
				</form>
			</div>

			{confirming ? (
				<ConfirmDialog
					title={t("accounts.unlinkTitle", { name: confirming.user.name })}
					body={t("accounts.unlinkBody", { email: confirming.user.email })}
					confirmLabel={t("accounts.unlink")}
					destructive
					pending={unlinkMut.isPending}
					onConfirm={() => unlinkMut.mutate(confirming)}
					onClose={() => setConfirming(null)}
				/>
			) : null}
			{pendingGoogle ? (
				<ConfirmDialog
					title={t("accounts.confirmLinkTitle", { name: pendingGoogle.user.name })}
					body={t("accounts.confirmLinkBody", { email: pendingGoogle.user.email })}
					confirmLabel={t("accounts.confirmLink")}
					destructive={false}
					pending={completeGoogleMut.isPending}
					onConfirm={() => completeGoogleMut.mutate(pendingGoogle.code)}
					onClose={() => setPendingGoogle(null)}
				/>
			) : null}
		</Panel>
	);
};

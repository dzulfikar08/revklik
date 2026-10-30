import { Button } from "@revklik/ui/components/button";
import { Checkbox } from "@revklik/ui/components/checkbox";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatDate, useLocale, useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { fetchSites } from "@/lib/legacy/api";
import type { SiteWithStats } from "@/lib/legacy/api";
import {
	createApiToken,
	fetchApiTokens,
	fetchShareStatus,
	fetchSubscriptionPlan,
	fetchWidgetStatus,
	publicEmbedCode,
	publicPageUrl,
	regenerateWidgetToken,
	revokeApiToken,
	shareUrl,
	toggleShare,
	toggleWidget,
	tokenLimitForPlan,
	updateWidgetConfig,
	widgetScriptUrl,
} from "@/lib/legacy/share-widget-tokens";
import type { ApiTokenInfo } from "@/lib/legacy/share-widget-tokens";

import { Panel, PanelTabs } from "./ui";

/* -------------------------------- helpers --------------------------------- */

const NoSite = () => {
	const t = useT();
	return <p className="text-muted-foreground text-xs">{t("share.selectSite")}</p>;
};

const LiveBadge = ({ label }: { label: string }) => (
	<span className="rounded-full border border-(--up)/20 bg-(--up)/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-(--up)">
		{label}
	</span>
);

const CopyButton = ({ text, label, className }: { text: string; label?: string; className?: string }) => {
	const t = useT();
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="outline"
			size="sm"
			className={className}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1600);
				} catch {
					toast.error(t("share.copyFailed"));
				}
			}}
		>
			{copied ? (
				<Check className="size-3.5" aria-hidden />
			) : (
				<Copy className="size-3.5" aria-hidden />
			)}
			{copied ? t("share.copied") : (label ?? t("share.copy"))}
		</Button>
	);
};

/* ------------------------------ share panel ------------------------------- */

const SharePanel = ({ siteId }: { siteId: string }) => {
	const t = useT();
	const qc = useQueryClient();
	const shareQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchShareStatus(siteId),
		queryKey: ["legacy", "share", siteId],
		retry: false,
		staleTime: 30_000,
	});

	const toggleMut = useMutation({
		mutationFn: () => toggleShare(siteId),
		onSuccess: (data) => {
			qc.setQueryData(["legacy", "share", siteId], data);
			toast.success(data.public ? t("share.public.enabledToast") : t("share.public.disabledToast"));
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const isPublic = shareQ.data?.public ?? false;
	const token = shareQ.data?.share_token ?? null;
	const url = isPublic && token ? shareUrl(token) : "";

	return (
		<Panel title={t("share.public.title")} hint={t("share.public.hint")}>
			{!siteId ? (
				<NoSite />
			) : shareQ.isLoading ? (
				<p className="text-muted-foreground text-xs">{t("share.loading")}</p>
			) : (
				<div className="grid gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={toggleMut.isPending || shareQ.isFetching}
							onClick={() => toggleMut.mutate()}
						>
							{isPublic ? t("share.public.disable") : t("share.public.enable")}
						</Button>
						{isPublic && <LiveBadge label={t("share.public.badge")} />}
					</div>
					{url && (
						<div className="flex items-center gap-1.5">
							<Input
								readOnly
								value={url}
								onFocus={(e) => e.target.select()}
								className="h-7 font-mono text-[11px]"
								aria-label={t("share.public.urlLabel")}
							/>
							<CopyButton text={url} className="shrink-0" />
						</div>
					)}
					{isPublic && token && (
						<div className="flex flex-wrap items-center gap-2">
							<CopyButton text={publicPageUrl(token)} label={t("share.public.copyLink")} />
							<CopyButton text={publicEmbedCode(token)} label={t("share.public.copyEmbed")} />
						</div>
					)}
					<p className="text-muted-foreground text-[11px]">{t("share.public.note")}</p>
				</div>
			)}
		</Panel>
	);
};

/* ------------------------------ widget panel ------------------------------ */

// East-positive UTC offset minutes, including the fractional zones (India,
// Iran, Nepal, Myanmar, ...). Sorted ascending for the dropdown.
const TZ_OFFSETS = [
	-720, -660, -600, -540, -480, -420, -360, -300, -270, -240, -210, -180, -120, -60, 0, 60, 120,
	180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 660, 720, 780, 840,
];

const fmtOffset = (min: number): string => {
	const sign = min < 0 ? "-" : "+";
	const abs = Math.abs(min);
	const h = String(Math.floor(abs / 60)).padStart(2, "0");
	const m = String(abs % 60).padStart(2, "0");
	return `UTC${sign}${h}:${m}`;
};

const WidgetPanel = ({ siteId }: { siteId: string }) => {
	const t = useT();
	const qc = useQueryClient();
	const [mode, setMode] = useState<"bubble" | "badge">("bubble");

	const widgetQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchWidgetStatus(siteId),
		queryKey: ["legacy", "widget", siteId],
		retry: false,
		staleTime: 30_000,
	});

	const invalidate = () => qc.invalidateQueries({ queryKey: ["legacy", "widget", siteId] });

	const toggleMut = useMutation({
		mutationFn: () => toggleWidget(siteId),
		onSuccess: invalidate,
		onError: (e: Error) => toast.error(e.message),
	});
	const regenerateMut = useMutation({
		mutationFn: () => regenerateWidgetToken(siteId),
		onSuccess: () => {
			invalidate();
			toast.success(t("share.widget.regeneratedToast"));
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const configMut = useMutation({
		mutationFn: (tzOffset: number) => updateWidgetConfig(siteId, { tz_offset: tzOffset }),
		onSuccess: invalidate,
		onError: (e: Error) => toast.error(e.message),
	});

	const enabled = widgetQ.data?.enabled ?? false;
	const token = widgetQ.data?.widget_token ?? "";
	const snippet =
		mode === "badge"
			? `<script async src="${widgetScriptUrl}" data-widget-token="${token}" data-mode="badge"></script>`
			: `<script async src="${widgetScriptUrl}" data-widget-token="${token}"></script>`;

	// Suggest the admin's own browser offset as the "today" boundary.
	const browserOffset = -new Date().getTimezoneOffset();
	const tzValue = widgetQ.data?.tz_offset ?? browserOffset;

	return (
		<Panel title={t("share.widget.title")} hint={t("share.widget.hint")}>
			{!siteId ? (
				<NoSite />
			) : widgetQ.isLoading ? (
				<p className="text-muted-foreground text-xs">{t("share.loading")}</p>
			) : (
				<div className="grid gap-2.5">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={toggleMut.isPending || widgetQ.isFetching}
							onClick={() => toggleMut.mutate()}
						>
							{enabled ? t("share.widget.disable") : t("share.widget.enable")}
						</Button>
						{enabled && <LiveBadge label={t("share.widget.badge")} />}
						{enabled && (
							<Button
								variant="outline"
								size="sm"
								disabled={regenerateMut.isPending}
								onClick={() => regenerateMut.mutate()}
							>
								<RefreshCw className="size-3.5" aria-hidden />
								{t("share.widget.regenerate")}
							</Button>
						)}
					</div>

					{enabled && (
						<>
							<div className="grid gap-1.5">
								<PanelTabs
									value={mode}
									onChange={setMode}
									tabs={[
										{ key: "bubble", label: t("share.widget.bubble") },
										{ key: "badge", label: t("share.widget.badgeMode") },
									]}
								/>
								<pre className="bg-muted/50 ring-foreground/10 overflow-x-auto rounded-lg p-2.5 ring-1 font-mono text-[11px] break-all whitespace-pre-wrap">
									{snippet}
								</pre>
								<CopyButton text={snippet} />
							</div>

							<div className="grid gap-1">
								<Label className="text-muted-foreground text-[10px] tracking-wider uppercase">
									{t("share.widget.tz")}
								</Label>
								<Select value={String(tzValue)} onValueChange={(v) => configMut.mutate(Number(v))}>
									<SelectTrigger
										className="h-7 w-56 text-xs"
										disabled={configMut.isPending}
										aria-label={t("share.widget.tzAria")}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TZ_OFFSETS.map((min) => (
											<SelectItem key={min} value={String(min)}>
												{fmtOffset(min)}
												{min === browserOffset ? ` (${t("share.widget.tzYou")})` : ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-muted-foreground text-[11px]">{t("share.widget.tzNote")}</p>
							</div>
						</>
					)}
				</div>
			)}
		</Panel>
	);
};

/* ------------------------------ tokens panel ------------------------------ */

const SCOPES: readonly { key: string; label: string; desc: MessageKey }[] = [
	{ key: "sites:read", label: "Sites: Read", desc: "share.tokens.scope.sitesRead" },
	{ key: "analytics:read", label: "Analytics: Read", desc: "share.tokens.scope.analyticsRead" },
	{
		key: "analytics:export",
		label: "Analytics: Export",
		desc: "share.tokens.scope.analyticsExport",
	},
	{ key: "tokens:read", label: "Tokens: Read", desc: "share.tokens.scope.tokensRead" },
	{ key: "tokens:write", label: "Tokens: Write", desc: "share.tokens.scope.tokensWrite" },
];
const DEFAULT_ACCOUNT_SCOPES = [
	"sites:read",
	"analytics:read",
	"analytics:export",
	"tokens:read",
	"tokens:write",
];
// Site tokens can only have analytics scopes.
const SITE_SCOPES = ["analytics:read", "analytics:export"];
const DEFAULT_SITE_SCOPES = [...SITE_SCOPES];

const TokenRow = ({
	token,
	onRevoke,
	revoking,
}: {
	token: ApiTokenInfo;
	onRevoke: (id: string) => void;
	revoking: boolean;
}) => {
	const t = useT();
	const locale = useLocale();
	const [confirming, setConfirming] = useState(false);

	return (
		<div className="ring-foreground/10 flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 ring-1">
			<div className="min-w-0 flex-1">
				<div className="mb-1 flex flex-wrap items-center gap-2">
					<span className="truncate text-[13px] font-medium">{token.name}</span>
					<span
						className={`rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase ${
							token.type === "account"
								? "border-primary/20 bg-primary/10 text-primary"
								: "border-(--up)/20 bg-(--up)/10 text-(--up)"
						}`}
					>
						{token.type === "account" ? t("share.tokens.typeAccount") : t("share.tokens.typeSite")}
					</span>
					<span className="bg-muted/60 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
						{token.prefix}…
					</span>
				</div>
				<div className="mb-1 flex flex-wrap gap-1">
					{token.scopes.map((scope) => (
						<span
							key={scope}
							className="text-muted-foreground rounded border px-1.5 py-px font-mono text-[9px]"
						>
							{scope}
						</span>
					))}
				</div>
				<div className="text-muted-foreground flex flex-wrap gap-3 text-[11px]">
					<span>{t("share.tokens.createdOn", { date: formatDate(token.created_at, locale) })}</span>
					{token.last_used_at && (
						<span>
							{t("share.tokens.lastUsed", { date: formatDate(token.last_used_at, locale) })}
						</span>
					)}
				</div>
			</div>
			{confirming ? (
				<div className="flex items-center gap-1.5">
					<span className="text-(--down) text-[11px]">{t("share.tokens.revokeConfirm")}</span>
					<Button
						variant="destructive"
						size="xs"
						disabled={revoking}
						onClick={() => onRevoke(token.id)}
					>
						{t("share.tokens.yes")}
					</Button>
					<Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
						{t("share.tokens.no")}
					</Button>
				</div>
			) : (
				<Button
					variant="outline"
					size="xs"
					className="text-(--down)"
					onClick={() => setConfirming(true)}
				>
					{t("share.tokens.revoke")}
				</Button>
			)}
		</div>
	);
};

const TokensPanel = ({ sites }: { sites: SiteWithStats[] }) => {
	const t = useT();
	const qc = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [type, setType] = useState<"account" | "site">("account");
	const [selectedSiteId, setSelectedSiteId] = useState("");
	const [scopes, setScopes] = useState<string[]>(DEFAULT_ACCOUNT_SCOPES);
	const [created, setCreated] = useState<null | {
		token: string;
		name: string;
	}>(null);

	const tokensQ = useQuery({
		queryFn: fetchApiTokens,
		queryKey: ["legacy", "tokens"],
		retry: false,
		staleTime: 30_000,
	});
	const planQ = useQuery({
		queryFn: fetchSubscriptionPlan,
		queryKey: ["legacy", "plan"],
		retry: false,
		staleTime: 300_000,
	});

	const tokens = tokensQ.data ?? [];
	const plan = planQ.data?.plan ?? "free";
	const limit = tokenLimitForPlan(plan);
	const used = tokens.length;
	const remaining = Number.isFinite(limit) ? Math.max(0, limit - used) : null;
	const limitReached = remaining !== null && remaining <= 0;

	const revokeMut = useMutation({
		mutationFn: (id: string) => revokeApiToken(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "tokens"] });
			toast.success(t("share.tokens.revokedToast"));
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const createMut = useMutation({
		mutationFn: () =>
			createApiToken({
				name,
				type,
				scopes,
				site_id: type === "site" ? selectedSiteId : undefined,
			}),
		onSuccess: (data) => {
			qc.invalidateQueries({ queryKey: ["legacy", "tokens"] });
			setCreated({ token: data.token, name: data.name });
			setName("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const handleTypeChange = (next: "account" | "site") => {
		setType(next);
		setScopes(next === "account" ? DEFAULT_ACCOUNT_SCOPES : DEFAULT_SITE_SCOPES);
	};

	const toggleScope = (scope: string) => {
		setScopes((prev) =>
			prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
		);
	};

	const availableScopes =
		type === "site" ? SCOPES.filter((s) => SITE_SCOPES.includes(s.key)) : SCOPES;

	const canCreate = Boolean(name) && (type === "account" || Boolean(selectedSiteId));

	const closeCreate = () => {
		setCreateOpen(false);
		setCreated(null);
		setType("account");
		setScopes(DEFAULT_ACCOUNT_SCOPES);
		setSelectedSiteId("");
	};

	const typeButton = (kind: "account" | "site", label: string, desc: string) => (
		<button
			type="button"
			onClick={() => handleTypeChange(kind)}
			className={`flex-1 rounded-lg border p-2 text-left text-[13px] transition-colors ${
				type === kind ? "border-primary/40 bg-primary/10" : "hover:bg-muted/60 border-transparent"
			}`}
		>
			<span className="block font-medium">{label}</span>
			<span className="text-muted-foreground block text-[11px]">{desc}</span>
		</button>
	);

	return (
		<Panel title={t("share.tokens.title")} hint={t("share.tokens.hint")}>
			<div className="grid gap-2.5">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
						<KeyRound className="size-3.5" aria-hidden />
						{t("share.tokens.usage", {
							plan,
							remaining:
								remaining === null
									? t("share.tokens.unlimited")
									: t("share.tokens.remaining", { n: remaining }),
							used: t("share.tokens.used", { n: used }),
						})}
					</span>
					<Button
						variant="outline"
						size="sm"
						className="ml-auto"
						disabled={limitReached}
						onClick={() => setCreateOpen(true)}
					>
						<Plus className="size-3.5" aria-hidden />
						{t("share.tokens.create")}
					</Button>
				</div>

				{limitReached && (
					<p className="text-(--down) rounded-lg bg-(--down)/10 px-2.5 py-1.5 text-[11px]">
						{t("share.tokens.limitReached", { limit, plan })}
					</p>
				)}

				{createOpen && (
					<div className="ring-foreground/10 grid gap-2.5 rounded-xl p-3 ring-1">
						{created ? (
							<div className="grid gap-2">
								<p className="text-(--down) rounded-lg bg-(--down)/10 px-2.5 py-1.5 text-[11px] font-semibold">
									{t("share.tokens.copyOnce")}
								</p>
								<div className="flex items-center gap-1.5">
									<code className="bg-muted/50 ring-foreground/10 min-w-0 flex-1 rounded-lg p-2.5 font-mono text-[12px] break-all ring-1">
										{created.token}
									</code>
									<CopyButton text={created.token} className="shrink-0" />
								</div>
								<p className="text-muted-foreground text-[11px]">
									{t("share.tokens.created", { name: created.name })}
								</p>
								<div>
									<Button size="sm" onClick={closeCreate}>
										{t("share.tokens.done")}
									</Button>
								</div>
							</div>
						) : (
							<div className="grid gap-2.5">
								<div className="grid gap-1">
									<Label
										htmlFor="token-name"
										className="text-muted-foreground text-[10px] tracking-wider uppercase"
									>
										{t("share.tokens.name")}
									</Label>
									<Input
										id="token-name"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder={t("share.tokens.namePlaceholder")}
										className="h-8 text-[13px]"
									/>
								</div>

								<div className="grid gap-1">
									<span className="text-muted-foreground text-[10px] tracking-wider uppercase">
										{t("share.tokens.type")}
									</span>
									<div className="flex gap-2">
										{typeButton(
											"account",
											t("share.tokens.typeAccount"),
											t("share.tokens.typeAccountDesc"),
										)}
										{typeButton("site", t("share.tokens.typeSite"), t("share.tokens.typeSiteDesc"))}
									</div>
								</div>

								{type === "site" && (
									<div className="grid gap-1">
										<Label
											htmlFor="token-site"
											className="text-muted-foreground text-[10px] tracking-wider uppercase"
										>
											{t("share.tokens.selectSite")}
										</Label>
										<Select
											value={selectedSiteId}
											onValueChange={(v) => setSelectedSiteId(String(v))}
										>
											<SelectTrigger className="h-8 text-[13px]" aria-label={t("share.tokens.siteAria")}>
												<SelectValue placeholder={t("share.tokens.sitePlaceholder")} />
											</SelectTrigger>
											<SelectContent>
												{sites.map((s) => (
													<SelectItem key={s.id} value={s.id}>
														{s.name} ({s.domain})
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}

								<div className="grid gap-1">
									<span className="text-muted-foreground text-[10px] tracking-wider uppercase">
										{t("share.tokens.scopes")}
									</span>
									<div className="grid gap-1">
										{availableScopes.map((scope) => (
											<label
												key={scope.key}
												className="hover:bg-muted/60 flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5"
											>
												<Checkbox
													checked={scopes.includes(scope.key)}
													onCheckedChange={() => toggleScope(scope.key)}
													aria-label={scope.label}
												/>
												<span>
													<span className="block font-mono text-[11px] font-semibold">
														{scope.label}
													</span>
													<span className="text-muted-foreground block text-[11px]">
														{t(scope.desc)}
													</span>
												</span>
											</label>
										))}
									</div>
								</div>

								<div className="flex gap-2">
									<Button
										size="sm"
										disabled={createMut.isPending || !canCreate}
										onClick={() => createMut.mutate()}
									>
										{createMut.isPending ? t("share.tokens.creating") : t("share.tokens.create")}
									</Button>
									<Button variant="ghost" size="sm" onClick={closeCreate}>
										{t("share.tokens.cancel")}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				{tokensQ.isLoading ? (
					<p className="text-muted-foreground text-xs">{t("share.loading")}</p>
				) : tokens.length === 0 ? (
					<p className="text-muted-foreground rounded-xl bg-muted/40 px-3 py-6 text-center text-xs">
						{t("share.tokens.empty")}
					</p>
				) : (
					<div className="grid gap-1.5">
						{tokens.map((token) => (
							<TokenRow
								key={token.id}
								token={token}
								revoking={revokeMut.isPending}
								onRevoke={(id) => revokeMut.mutate(id)}
							/>
						))}
					</div>
				)}
			</div>
		</Panel>
	);
};

/* ------------------------------ composed view ----------------------------- */

/**
 * `siteId` is the site in the URL. It is the only source of truth for the
 * public link and the widget: reading a remembered selection here once made
 * "Enable public link" act on a different site than the one on screen.
 */
export const ShareWidgetTokensView = ({ siteId }: { siteId: string }) => {
	const t = useT();
	const sitesQ = useQuery({
		queryFn: () => fetchSites("30d"),
		queryKey: ["legacy", "sites", "30d"],
		retry: false,
		staleTime: 60_000,
	});
	const sites = sitesQ.data ?? [];
	const domain = sites.find((s) => s.id === siteId)?.domain;
	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<div className="mb-2.5">
				<h1 className="text-lg font-semibold tracking-tight">{t("share.title")}</h1>
				<p className="text-muted-foreground text-xs">
					{domain ? t("share.subtitle", { domain }) : t("share.subtitleNoSite")}
				</p>
			</div>
			<div className="grid gap-2.5 md:grid-cols-2">
				<SharePanel siteId={siteId} />
				<WidgetPanel siteId={siteId} />
				<div className="md:col-span-2">
					<TokensPanel sites={sites} />
				</div>
			</div>
		</main>
	);
};

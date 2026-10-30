import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
	disconnectPolar,
	fetchPolarStatus,
	savePolarConfig,
	syncPolarOrders,
} from "@/lib/legacy/integrations";
import { formatDate, useLocale, useT } from "@/lib/i18n";
import type { Locale, MessageKey } from "@/lib/i18n";
import type {
	PolarConfigInput,
	PolarDelivery,
	PolarStatus,
	PolarSyncResult,
} from "@/lib/legacy/integrations";

import { Panel, SkeletonRows, StatusPill } from "./ui";

const POLAR_WEBHOOKS_URL = "https://polar.sh/to/dashboard/settings/webhooks";
const POLAR_TOKENS_URL = "https://polar.sh/to/dashboard/settings/access-tokens";
const POLAR_PREFIX = /^polar_/;
const INVALID_SIGNATURE = "polar_invalid_sig";
const COPIED_MS = 2000;
const HOURLY_LOOKBACK_DAYS = 14;

/** Events RevKlik books; every other event Polar sends is logged and ignored. */
const REQUIRED_EVENTS = ["order.paid", "order.refunded"] as const;

const SYNC_WINDOWS = [
	{ days: 30, key: "30", label: "polar.sync.window.30" },
	{ days: 365, key: "365", label: "polar.sync.window.365" },
	{ days: "all", key: "all", label: "polar.sync.window.all" },
] as const;

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const fieldClass = "h-8 font-mono text-xs max-md:h-11";
const buttonClass = "max-md:h-11 max-md:px-4";

const ErrorNote = ({ children }: { children: ReactNode }) => (
	<p className="bg-(--down)/10 text-(--down) rounded-lg px-3 py-2 text-xs" role="alert">
		{children}
	</p>
);

const OkNote = ({ children }: { children: ReactNode }) => (
	<p className="bg-(--up)/10 text-(--up) rounded-lg px-3 py-2 text-xs" role="status">
		{children}
	</p>
);

const deliveryName = (type: string, t: T): string =>
	type === INVALID_SIGNATURE ? t("polar.delivery.badSignature") : type.replace(POLAR_PREFIX, "");

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = 60_000;

/** Relative time in the active language; older than a day falls back to a date. */
const agoText = (iso: string, t: T, locale: Locale): string => {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) {
		return "";
	}
	const mins = Math.max(0, Math.round((Date.now() - at) / MS_PER_MINUTE));
	if (mins < 1) {
		return t("polar.ago.now");
	}
	if (mins < MINUTES_PER_HOUR) {
		return t("polar.ago.minutes", { n: mins });
	}
	const hours = Math.round(mins / MINUTES_PER_HOUR);
	if (hours < HOURS_PER_DAY) {
		return t("polar.ago.hours", { n: hours });
	}
	return formatDate(iso, locale);
};

const deliveryStatus = (status: string, t: T): string => {
	if (status === "processed") {
		return t("polar.delivery.processed");
	}
	if (status === "failed") {
		return t("polar.delivery.failed");
	}
	return status;
};

interface Connection {
	label: string;
	tone: "up" | "down" | "muted";
}

/** One word for the header: is the endpoint set up, and is Polar reaching it. */
const connectionOf = (status: PolarStatus, t: T): Connection => {
	if (!status.webhook_secret_configured) {
		return { label: t("polar.conn.notConnected"), tone: "muted" };
	}
	const latest = status.events[0];
	if (!latest) {
		return { label: t("polar.conn.waiting"), tone: "muted" };
	}
	if (latest.event_type === INVALID_SIGNATURE) {
		return { label: t("polar.conn.mismatch"), tone: "down" };
	}
	return { label: t("polar.conn.receiving"), tone: "up" };
};

const describeSync = (result: PolarSyncResult, t: T): string => {
	if (result.scanned === 0) {
		return t("polar.sync.noOrders");
	}
	const base = t("polar.sync.summary", {
		imported: result.imported,
		unchanged: result.unchanged,
		updated: result.updated,
	});
	return result.more ? `${base} ${t("polar.sync.more")}` : base;
};

const CopyUrl = ({ value }: { value: string }) => {
	const t = useT();
	const [copied, setCopied] = useState(false);
	return (
		<div className="bg-muted/60 flex items-center gap-2 rounded-lg px-2.5 py-2">
			<code className="min-w-0 flex-1 font-mono text-[11px] break-all">{value}</code>
			<Button
				variant="outline"
				size="sm"
				className="shrink-0 max-md:h-11 max-md:px-4"
				onClick={() => {
					navigator.clipboard.writeText(value);
					setCopied(true);
					setTimeout(() => setCopied(false), COPIED_MS);
				}}
			>
				<Copy className="size-3" aria-hidden />
				{copied ? t("polar.copied") : t("polar.copyUrl")}
			</Button>
		</div>
	);
};

const DeliveryRow = ({ delivery }: { delivery: PolarDelivery }) => {
	const t = useT();
	const locale = useLocale();
	return (
		<li className="border-(--border) flex items-center justify-between gap-3 border-t py-1.5 text-xs first:border-t-0">
			<code className="min-w-0 flex-1 truncate font-mono">
				{deliveryName(delivery.event_type, t)}
			</code>
			<StatusPill
				on={delivery.status === "processed"}
				tone={delivery.status === "failed" ? "down" : undefined}
				label={deliveryStatus(delivery.status, t)}
			/>
			<span className="text-muted-foreground w-16 shrink-0 text-right tabular-nums">
				{agoText(delivery.created_at, t, locale)}
			</span>
		</li>
	);
};

const Deliveries = ({
	status,
	refreshing,
	onRefresh,
}: {
	status: PolarStatus;
	refreshing: boolean;
	onRefresh: () => void;
}) => {
	const t = useT();
	const rejected = status.events[0]?.event_type === INVALID_SIGNATURE;
	return (
		<section className="border-(--border) mt-4 border-t pt-3" aria-labelledby="polar-deliveries">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<h3 id="polar-deliveries" className="text-xs font-semibold">
					{t("polar.deliveries.title")}
				</h3>
				<Button
					variant="outline"
					size="sm"
					className={buttonClass}
					onClick={onRefresh}
					disabled={refreshing}
				>
					<RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
					{refreshing ? t("polar.refreshing") : t("polar.refresh")}
				</Button>
			</div>
			{rejected ? <ErrorNote>{t("polar.deliveries.rejected")}</ErrorNote> : null}
			{status.events.length === 0 ? (
				<p className="text-muted-foreground text-xs leading-relaxed">
					{status.webhook_secret_configured
						? t("polar.deliveries.empty")
						: t("polar.deliveries.emptyNoSecret")}
				</p>
			) : (
				<ul>
					{status.events.slice(0, 6).map((delivery) => (
						<DeliveryRow key={delivery.id} delivery={delivery} />
					))}
				</ul>
			)}
		</section>
	);
};

const InPolar = ({ url }: { url: string }) => {
	const t = useT();
	return (
		<section aria-labelledby="polar-in-polar" className="grid content-start gap-2">
			<h3 id="polar-in-polar" className="text-xs font-semibold">
				{t("polar.inPolar")}
			</h3>
			<CopyUrl value={url} />
			<ol className="text-muted-foreground list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
				<li>
					{t("polar.step1.before")}{" "}
					<a
						href={POLAR_WEBHOOKS_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="text-foreground underline underline-offset-2"
					>
						{t("polar.step1.link")}
					</a>{" "}
					{t("polar.step1.after")}
				</li>
				<li>{t("polar.step2")}</li>
				<li>
					{t("polar.step3.lead")}{" "}
					{REQUIRED_EVENTS.map((name) => (
						<code
							key={name}
							className="bg-muted text-foreground mr-1 rounded px-1 py-0.5 font-mono text-[11px]"
						>
							{name}
						</code>
					))}{" "}
					{t("polar.step3.tail")}
				</li>
				<li>{t("polar.step4")}</li>
			</ol>
		</section>
	);
};

const SecretForm = ({
	configured,
	onSave,
	pending,
	error,
}: {
	configured: boolean;
	onSave: (secret: string) => void;
	pending: boolean;
	error: string;
}) => {
	const t = useT();
	const [secret, setSecret] = useState("");
	return (
		<form
			className="grid gap-1.5"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(secret);
				setSecret("");
			}}
		>
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor="polar-secret" className="text-xs">
					{t("polar.secret.label")}
				</Label>
				{configured ? <StatusPill on label={t("polar.saved")} /> : null}
			</div>
			<Input
				id="polar-secret"
				type="password"
				autoComplete="off"
				spellCheck={false}
				value={secret}
				onChange={(e) => setSecret(e.target.value)}
				placeholder={
					configured ? t("polar.secret.placeholderReplace") : t("polar.secret.placeholder")
				}
				className={fieldClass}
			/>
			{error ? <ErrorNote>{error}</ErrorNote> : null}
			<div>
				<Button
					type="submit"
					size="sm"
					className={buttonClass}
					disabled={pending || !secret.trim()}
				>
					{pending
						? t("polar.saving")
						: configured
							? t("polar.secret.replace")
							: t("polar.secret.save")}
				</Button>
			</div>
		</form>
	);
};

const queryKey = (siteId: string) => ["legacy", "polar", siteId] as const;

const SyncForm = ({
	status,
	siteId,
	onStatus,
	onSynced,
}: {
	status: PolarStatus;
	siteId: string;
	onStatus: (next: PolarStatus) => void;
	onSynced: () => void;
}) => {
	const t = useT();
	const locale = useLocale();
	const [token, setToken] = useState("");
	const [orgId, setOrgId] = useState(status.organization_id);
	const [lookback, setLookback] = useState<string>(SYNC_WINDOWS[0].key);
	const [error, setError] = useState("");
	const [result, setResult] = useState("");

	const save = useMutation({
		mutationFn: (input: PolarConfigInput) => savePolarConfig(siteId, input),
		onError: (err: Error) => setError(err.message),
		onSuccess: (next) => {
			setError("");
			setToken("");
			onStatus(next);
			toast.success(t("polar.token.saved"));
		},
	});
	const sync = useMutation({
		mutationFn: () => {
			const days = SYNC_WINDOWS.find((w) => w.key === lookback)?.days ?? 30;
			return syncPolarOrders(siteId, days);
		},
		onError: (err: Error) => {
			setResult("");
			setError(err.message);
		},
		onSettled: onSynced,
		onSuccess: (done) => {
			setError("");
			setResult(describeSync(done, t));
		},
	});

	const tokenSaved = status.access_token_configured;
	return (
		<div className="grid gap-2">
			<form
				className="grid gap-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					const trimmed = token.trim();
					// An empty token field leaves the saved token alone; only "Remove token" clears it.
					save.mutate({
						...(trimmed ? { access_token: trimmed } : {}),
						organization_id: orgId.trim(),
					});
				}}
			>
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor="polar-token" className="text-xs">
						{t("polar.token.label")}
					</Label>
					{tokenSaved ? <StatusPill on label={t("polar.saved")} /> : null}
				</div>
				<Input
					id="polar-token"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={token}
					onChange={(e) => setToken(e.target.value)}
					placeholder={tokenSaved ? t("polar.token.placeholderReplace") : "polar_oat_..."}
					className={fieldClass}
				/>
				<Label htmlFor="polar-org" className="text-xs">
					{t("polar.token.orgLabel")}
				</Label>
				<Input
					id="polar-org"
					autoComplete="off"
					spellCheck={false}
					value={orgId}
					onChange={(e) => setOrgId(e.target.value)}
					placeholder={t("polar.token.orgPlaceholder")}
					className={fieldClass}
				/>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{t("polar.token.help.a")}{" "}
					<a
						href={POLAR_TOKENS_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="text-foreground underline underline-offset-2"
					>
						{t("polar.token.help.link")}
					</a>{" "}
					{t("polar.token.help.b")} <code className="font-mono">orders:read</code>{" "}
					{t("polar.token.help.c")} <code className="font-mono">refunds:read</code>{" "}
					{t("polar.token.help.d", { days: HOURLY_LOOKBACK_DAYS })}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						type="submit"
						size="sm"
						className={buttonClass}
						disabled={save.isPending || (!token.trim() && orgId.trim() === status.organization_id)}
					>
						{save.isPending ? t("polar.saving") : t("polar.token.save")}
					</Button>
					{tokenSaved ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={`${buttonClass} text-(--down) hover:text-(--down)`}
							onClick={() => save.mutate({ access_token: "" })}
							disabled={save.isPending}
						>
							{t("polar.token.remove")}
						</Button>
					) : null}
				</div>
			</form>

			<div className="border-(--border) grid gap-1.5 border-t pt-2">
				<Label htmlFor="polar-window" className="text-xs">
					{t("polar.sync.from")}
				</Label>
				<div className="flex flex-wrap items-center gap-2">
					<select
						id="polar-window"
						value={lookback}
						onChange={(e) => setLookback(e.target.value)}
						className="border-input bg-background h-8 rounded-md border px-2 text-xs max-md:h-11"
					>
						{SYNC_WINDOWS.map((w) => (
							<option key={w.key} value={w.key}>
								{t(w.label)}
							</option>
						))}
					</select>
					<Button
						size="sm"
						className={buttonClass}
						onClick={() => {
							setError("");
							setResult("");
							sync.mutate();
						}}
						disabled={sync.isPending || !tokenSaved}
					>
						<RefreshCw className={`size-3 ${sync.isPending ? "animate-spin" : ""}`} aria-hidden />
						{sync.isPending ? t("polar.sync.running") : t("polar.sync.now")}
					</Button>
				</div>
				{tokenSaved ? null : (
					<p className="text-muted-foreground text-xs">{t("polar.sync.needToken")}</p>
				)}
				{result ? <OkNote>{result}</OkNote> : null}
				{error ? <ErrorNote>{error}</ErrorNote> : null}
				{status.last_sync_at && !status.last_sync_error ? (
					<p className="text-muted-foreground text-xs">
						{t("polar.sync.last", { ago: agoText(status.last_sync_at, t, locale) })}
						{status.last_sync_summary ? `: ${status.last_sync_summary}` : ""}
					</p>
				) : null}
				{status.last_sync_error && !error ? (
					<ErrorNote>{t("polar.sync.error", { error: status.last_sync_error })}</ErrorNote>
				) : null}
			</div>
		</div>
	);
};

export const PolarConnectPanel = ({ siteId }: { siteId: string }) => {
	const qc = useQueryClient();
	const t = useT();
	const [secretError, setSecretError] = useState("");

	const statusQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchPolarStatus(siteId),
		queryKey: queryKey(siteId),
		retry: false,
	});
	const setStatus = (next: PolarStatus) => qc.setQueryData(queryKey(siteId), next);

	const saveSecret = useMutation({
		mutationFn: (secret: string) => savePolarConfig(siteId, { webhook_secret: secret.trim() }),
		onError: (err: Error) => setSecretError(err.message),
		onSuccess: (next) => {
			setSecretError("");
			setStatus(next);
			toast.success(t("polar.secret.saved"));
		},
	});
	const disconnect = useMutation({
		mutationFn: async () => {
			if (!window.confirm(t("polar.disconnect.confirm"))) {
				return false;
			}
			await disconnectPolar(siteId);
			return true;
		},
		onError: (err: Error) => toast.error(err.message),
		onSuccess: (done) => {
			if (done) {
				qc.invalidateQueries({ queryKey: queryKey(siteId) });
				toast.success(t("polar.disconnected"));
			}
		},
	});

	const status = statusQ.data;
	const connection = status ? connectionOf(status, t) : null;

	return (
		<Panel
			title={t("polar.title")}
			hint={
				connection ? (
					<StatusPill
						on={connection.tone === "up"}
						tone={connection.tone}
						label={connection.label}
					/>
				) : undefined
			}
		>
			<p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
				{t("polar.intro")}
			</p>

			{statusQ.isLoading ? (
				<div className="mt-3">
					<SkeletonRows rows={4} label={t("polar.loading")} />
				</div>
			) : statusQ.error || !status ? (
				<div className="mt-3 grid gap-2">
					<ErrorNote>
						{statusQ.error instanceof Error ? statusQ.error.message : t("polar.loadFailed")}
					</ErrorNote>
					<div>
						<Button
							variant="outline"
							size="sm"
							className={buttonClass}
							onClick={() => statusQ.refetch()}
						>
							{t("polar.retry")}
						</Button>
					</div>
				</div>
			) : (
				<>
					<div className="mt-3 grid gap-5 md:grid-cols-2">
						<InPolar url={status.webhook_url} />
						<section aria-labelledby="polar-in-revklik" className="grid content-start gap-3">
							<h3 id="polar-in-revklik" className="text-xs font-semibold">
								{t("polar.inRevklik")}
							</h3>
							<SecretForm
								configured={status.webhook_secret_configured}
								onSave={(secret) => saveSecret.mutate(secret)}
								pending={saveSecret.isPending}
								error={secretError}
							/>
							<SyncForm
								key={status.site_id}
								status={status}
								siteId={siteId}
								onStatus={setStatus}
								onSynced={() => qc.invalidateQueries({ queryKey: queryKey(siteId) })}
							/>
						</section>
					</div>
					<Deliveries
						status={status}
						refreshing={statusQ.isFetching}
						onRefresh={() => statusQ.refetch()}
					/>
					{status.connected ? (
						<div className="mt-3">
							<Button
								variant="ghost"
								size="sm"
								className={`${buttonClass} text-(--down) hover:text-(--down)`}
								onClick={() => disconnect.mutate()}
								disabled={disconnect.isPending}
							>
								<Trash2 className="size-3.5" aria-hidden />
								{t("polar.disconnect")}
							</Button>
						</div>
					) : null}
				</>
			)}
		</Panel>
	);
};

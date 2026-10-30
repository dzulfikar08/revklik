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
import type {
	PolarConfigInput,
	PolarDelivery,
	PolarStatus,
	PolarSyncResult,
} from "@/lib/legacy/integrations";

import { agoLabel } from "./data";
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
	{ days: 30, key: "30", label: "Last 30 days" },
	{ days: 365, key: "365", label: "Last 12 months" },
	{ days: "all", key: "all", label: "All time" },
] as const;

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

const deliveryName = (type: string): string =>
	type === INVALID_SIGNATURE ? "Signature rejected" : type.replace(POLAR_PREFIX, "");

interface Connection {
	label: string;
	tone: "up" | "down" | "muted";
}

/** One word for the header: is the endpoint set up, and is Polar reaching it. */
const connectionOf = (status: PolarStatus): Connection => {
	if (!status.webhook_secret_configured) {
		return { label: "Not connected", tone: "muted" };
	}
	const latest = status.events[0];
	if (!latest) {
		return { label: "Waiting for first event", tone: "muted" };
	}
	if (latest.event_type === INVALID_SIGNATURE) {
		return { label: "Signature mismatch", tone: "down" };
	}
	return { label: "Receiving", tone: "up" };
};

const describeSync = (result: PolarSyncResult): string => {
	if (result.scanned === 0) {
		return "Polar returned no orders for that period.";
	}
	const base = `${result.imported} new, ${result.updated} updated, ${result.unchanged} already booked.`;
	return result.more ? `${base} More orders remain, sync again to continue.` : base;
};

const CopyUrl = ({ value }: { value: string }) => {
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
				{copied ? "Copied" : "Copy URL"}
			</Button>
		</div>
	);
};

const DeliveryRow = ({ delivery }: { delivery: PolarDelivery }) => (
	<li className="border-(--border) flex items-center justify-between gap-3 border-t py-1.5 text-xs first:border-t-0">
		<code className="min-w-0 flex-1 truncate font-mono">{deliveryName(delivery.event_type)}</code>
		<StatusPill
			on={delivery.status === "processed"}
			tone={delivery.status === "failed" ? "down" : undefined}
			label={delivery.status}
		/>
		<span className="text-muted-foreground w-16 shrink-0 text-right tabular-nums">
			{agoLabel(delivery.created_at)}
		</span>
	</li>
);

const Deliveries = ({
	status,
	refreshing,
	onRefresh,
}: {
	status: PolarStatus;
	refreshing: boolean;
	onRefresh: () => void;
}) => {
	const rejected = status.events[0]?.event_type === INVALID_SIGNATURE;
	return (
		<section className="border-(--border) mt-4 border-t pt-3" aria-labelledby="polar-deliveries">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<h3 id="polar-deliveries" className="text-xs font-semibold">
					Deliveries received
				</h3>
				<Button
					variant="outline"
					size="sm"
					className={buttonClass}
					onClick={onRefresh}
					disabled={refreshing}
				>
					<RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
					{refreshing ? "Refreshing" : "Refresh"}
				</Button>
			</div>
			{rejected ? (
				<ErrorNote>
					Polar is reaching RevKlik, but the signature did not match. Copy the secret of the same
					endpoint in Polar and save it again.
				</ErrorNote>
			) : null}
			{status.events.length === 0 ? (
				<p className="text-muted-foreground text-xs leading-relaxed">
					{status.webhook_secret_configured
						? "Nothing received yet. Make a test purchase, or redeliver an event from the endpoint's deliveries list in Polar, then press Refresh."
						: "Deliveries appear here once the endpoint exists in Polar and its secret is saved."}
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

const InPolar = ({ url }: { url: string }) => (
	<section aria-labelledby="polar-in-polar" className="grid content-start gap-2">
		<h3 id="polar-in-polar" className="text-xs font-semibold">
			In Polar
		</h3>
		<CopyUrl value={url} />
		<ol className="text-muted-foreground list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
			<li>
				Open{" "}
				<a
					href={POLAR_WEBHOOKS_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="text-foreground underline underline-offset-2"
				>
					Settings, Webhooks
				</a>{" "}
				and choose Add Endpoint.
			</li>
			<li>Paste the URL above. Leave Format on Raw.</li>
			<li>
				Tick these events:{" "}
				{REQUIRED_EVENTS.map((name) => (
					<code
						key={name}
						className="bg-muted text-foreground mr-1 rounded px-1 py-0.5 font-mono text-[11px]"
					>
						{name}
					</code>
				))}{" "}
				Renewals are orders too, so no subscription events are needed.
			</li>
			<li>
				Create the endpoint, then copy its secret into the box on the right. Polar can generate the
				secret, or you can set your own.
			</li>
		</ol>
	</section>
);

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
					Webhook secret
				</Label>
				{configured ? <StatusPill on label="Saved" /> : null}
			</div>
			<Input
				id="polar-secret"
				type="password"
				autoComplete="off"
				spellCheck={false}
				value={secret}
				onChange={(e) => setSecret(e.target.value)}
				placeholder={
					configured ? "Paste a new secret to replace it" : "Paste the secret from Polar"
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
					{pending ? "Saving" : configured ? "Replace secret" : "Save secret"}
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
			toast.success("Polar sync settings saved");
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
			setResult(describeSync(done));
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
						Organization Access Token (optional)
					</Label>
					{tokenSaved ? <StatusPill on label="Saved" /> : null}
				</div>
				<Input
					id="polar-token"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={token}
					onChange={(e) => setToken(e.target.value)}
					placeholder={tokenSaved ? "Paste a new token to replace it" : "polar_oat_..."}
					className={fieldClass}
				/>
				<Label htmlFor="polar-org" className="text-xs">
					Organization ID (optional)
				</Label>
				<Input
					id="polar-org"
					autoComplete="off"
					spellCheck={false}
					value={orgId}
					onChange={(e) => setOrgId(e.target.value)}
					placeholder="Only needed if the token spans organizations"
					className={fieldClass}
				/>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Create the token in{" "}
					<a
						href={POLAR_TOKENS_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="text-foreground underline underline-offset-2"
					>
						Settings, Access Tokens
					</a>{" "}
					with the <code className="font-mono">orders:read</code> scope, plus{" "}
					<code className="font-mono">refunds:read</code> so refunds land on the day they happened.
					It lets RevKlik fetch orders itself: the manual sync below, and an hourly check of the
					last {HOURLY_LOOKBACK_DAYS} days that catches missed webhooks, refunds and Polar's real
					fee.
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						type="submit"
						size="sm"
						className={buttonClass}
						disabled={save.isPending || (!token.trim() && orgId.trim() === status.organization_id)}
					>
						{save.isPending ? "Saving" : "Save token"}
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
							Remove token
						</Button>
					) : null}
				</div>
			</form>

			<div className="border-(--border) grid gap-1.5 border-t pt-2">
				<Label htmlFor="polar-window" className="text-xs">
					Sync orders from
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
								{w.label}
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
						{sync.isPending ? "Syncing" : "Sync orders now"}
					</Button>
				</div>
				{tokenSaved ? null : (
					<p className="text-muted-foreground text-xs">Save an access token to turn this on.</p>
				)}
				{result ? <OkNote>{result}</OkNote> : null}
				{error ? <ErrorNote>{error}</ErrorNote> : null}
				{status.last_sync_at && !status.last_sync_error ? (
					<p className="text-muted-foreground text-xs">
						Last sync {agoLabel(status.last_sync_at)}
						{status.last_sync_summary ? `: ${status.last_sync_summary}` : ""}
					</p>
				) : null}
				{status.last_sync_error && !error ? (
					<ErrorNote>Last sync failed: {status.last_sync_error}</ErrorNote>
				) : null}
			</div>
		</div>
	);
};

export const PolarConnectPanel = ({ siteId }: { siteId: string }) => {
	const qc = useQueryClient();
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
			toast.success("Webhook secret saved");
		},
	});
	const disconnect = useMutation({
		mutationFn: async () => {
			if (!window.confirm("Disconnect Polar? The saved secret and token are deleted.")) {
				return false;
			}
			await disconnectPolar(siteId);
			return true;
		},
		onError: (err: Error) => toast.error(err.message),
		onSuccess: (done) => {
			if (done) {
				qc.invalidateQueries({ queryKey: queryKey(siteId) });
				toast.success("Polar disconnected");
			}
		},
	});

	const status = statusQ.data;
	const connection = status ? connectionOf(status) : null;

	return (
		<Panel
			title="Polar"
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
				Books every Polar order for this site with Polar's own fee and any refund. Paid orders
				arrive through a webhook the moment they happen.
			</p>

			{statusQ.isLoading ? (
				<div className="mt-3">
					<SkeletonRows rows={4} label="Loading the Polar connection" />
				</div>
			) : statusQ.error || !status ? (
				<div className="mt-3 grid gap-2">
					<ErrorNote>
						{statusQ.error instanceof Error
							? statusQ.error.message
							: "The Polar connection could not be loaded."}
					</ErrorNote>
					<div>
						<Button
							variant="outline"
							size="sm"
							className={buttonClass}
							onClick={() => statusQ.refetch()}
						>
							Try again
						</Button>
					</div>
				</div>
			) : (
				<>
					<div className="mt-3 grid gap-5 md:grid-cols-2">
						<InPolar url={status.webhook_url} />
						<section aria-labelledby="polar-in-revklik" className="grid content-start gap-3">
							<h3 id="polar-in-revklik" className="text-xs font-semibold">
								In RevKlik
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
								Disconnect Polar
							</Button>
						</div>
					) : null}
				</>
			)}
		</Panel>
	);
};

import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { Textarea } from "@revklik/ui/components/textarea";
import { syncAppStore } from "@/lib/legacy/appstoreconnect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Apple,
	Bird,
	Citrus,
	Copy,
	CreditCard,
	ExternalLink,
	Feather,
	Hexagon,
	Mail,
	Megaphone,
	RefreshCw,
	Search,
	ShoppingBag,
	Store,
	Target,
	Trash2,
	Wallet,
	Webhook,
	Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
	createIntegration,
	createPaymentProvider,
	deleteIntegration,
	deletePaymentProvider,
	fetchGscQueries,
	fetchIntegrations,
	fetchMarketplaceOrders,
	fetchPaymentProviders,
	fetchWebhookEvents,
	gscAuthUrl,
	marketplaceAuthUrl,
	syncGsc,
	syncMarketplaceOrders,
	testIntegration,
	updateIntegration,
	WORKER_ORIGIN,
} from "@/lib/legacy/integrations";
import type {
	CreateIntegrationPayload,
	IntegrationTestResult,
	LegacyIntegration,
	LegacyIntegrationType,
	LegacyMarketplaceOrder,
	Marketplace,
} from "@/lib/legacy/integrations";

import { ImportsView } from "./imports-view";
import { PolarConnectPanel } from "./polar-connect-panel";
import { Panel, PanelTabs, StatusPill } from "./ui";

/* ------------------------------ provider meta ------------------------------ */

interface ProviderField {
	key: string;
	label: string;
	placeholder: string;
	secret?: boolean;
	/** Multi-secret paste (e.g. PEM) — renders a textarea instead of an input. */
	multiline?: boolean;
	/** Where to find the value, shown under the field. */
	hint?: string;
}

interface ProviderMeta {
	type: LegacyIntegrationType;
	name: string;
	description: string;
	icon: LucideIcon;
	fields: ProviderField[];
	/** Step-by-step acquisition guide rendered inside the connect form. */
	instructions?: ReactNode;
}
/* API-key webhook integrations — configured inline, tested against the provider. */
export const WEBHOOK_PROVIDERS: ProviderMeta[] = [
	{
		type: "mailchimp",
		name: "Mailchimp",
		description: "Sync subscriber data and track email engagement",
		icon: Mail,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "your-mailchimp-api-key", secret: true },
			{ key: "dc", label: "Server Prefix", placeholder: "us1" },
		],
	},
	{
		type: "convertkit",
		name: "ConvertKit",
		description: "Connect your ConvertKit audience data",
		icon: Bird,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "your-convertkit-api-key", secret: true },
		],
	},
	{
		type: "kit",
		name: "Kit",
		description: "Sync with Kit (formerly ConvertKit) v3 API",
		icon: Feather,
		fields: [{ key: "api_key", label: "API Key", placeholder: "your-kit-api-key", secret: true }],
	},
	{
		type: "beehiiv",
		name: "Beehiiv",
		description: "Track newsletter subscriber activity",
		icon: Hexagon,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "your-beehiiv-api-key", secret: true },
			{ key: "publication_id", label: "Publication ID", placeholder: "pub_..." },
		],
	},
	{
		type: "meta_ads",
		name: "Meta Ads",
		description: "Import ad performance and conversion data",
		icon: Target,
		fields: [
			{
				key: "access_token",
				label: "Access Token",
				placeholder: "your-meta-access-token",
				secret: true,
			},
			{ key: "pixel_id", label: "Pixel ID", placeholder: "123456789" },
		],
	},
	{
		type: "google_ads",
		name: "Google Ads",
		description: "Link Google Ads campaign data",
		icon: Megaphone,
		fields: [
			{ key: "client_id", label: "Client ID", placeholder: "your-client-id" },
			{
				key: "client_secret",
				label: "Client Secret",
				placeholder: "your-client-secret",
				secret: true,
			},
			{
				key: "refresh_token",
				label: "Refresh Token",
				placeholder: "your-refresh-token",
				secret: true,
			},
			{ key: "customer_id", label: "Customer ID", placeholder: "123-456-7890" },
		],
	},
	{
		type: "appstoreconnect",
		name: "App Store Connect",
		description:
			"Sync App Store downloads, proceeds, and price changes into the same view as web revenue",
		icon: Apple,
		fields: [
			{
				key: "issuer_id",
				label: "Issuer ID",
				placeholder: "69a6de7c-…  (UUID)",
				hint: "App Store Connect → Users and Access → Integrations → App Store Connect API — shown above the keys table.",
			},
			{
				key: "key_id",
				label: "Key ID",
				placeholder: "ABC123DEFG",
				hint: "Same page — the 10-character ID next to the key you generate in step 2 below.",
			},
			{
				key: "private_key",
				label: "Private Key (.p8)",
				placeholder: "-----BEGIN PRIVATE KEY-----\nMIGT…\n-----END PRIVATE KEY-----",
				secret: true,
				multiline: true,
				hint: "The full .p8 contents including the BEGIN/END lines. Downloaded once when the key is created — if lost, revoke the key and create a new one.",
			},
			{
				key: "app_id",
				label: "App ID (Apple ID)",
				placeholder: "123456789",
				hint: "Apps → your app → General → App Information → Apple ID (the 10-digit number).",
			},
			{
				key: "vendor_number",
				label: "Vendor Number",
				placeholder: "1234567",
				hint: "Payments and Financial Reports → top-left, under your Legal Entity Name.",
			},
			{
				key: "backfill_days",
				label: "Backfill Days (optional)",
				placeholder: "30",
				hint: "How far back to pull on first sync (max 90). Apple keeps 13 months of reports.",
			},
		],
		instructions: (
			<div className="bg-muted/50 border-border/60 grid gap-1.5 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed">
				<p className="text-foreground/80 font-semibold">Before you start</p>
				<p className="text-muted-foreground">
					The Paid Applications Agreement must be signed (Agreements, Tax, and Banking) — without it
					Apple has no sales reports to give.
				</p>
				<p className="text-foreground/80 font-semibold">Step 1 — create an API key</p>
				<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
					<li>
						Go to{" "}
						<a
							className="underline underline-offset-2"
							href="https://appstoreconnect.apple.com/access/integrations/api"
							target="_blank"
							rel="noreferrer"
						>
							appstoreconnect.apple.com → Users and Access → Integrations
						</a>{" "}
						and note the <strong className="text-foreground">Issuer ID</strong> shown above the keys
						table.
					</li>
					<li>
						Click <strong className="text-foreground">+</strong> to generate a new key. Name it
						(e.g. "RevKlik analytics") and pick the{" "}
						<strong className="text-foreground">Admin</strong> role — Admin enables engagement
						metrics (impressions, page views). The roles "Finance" or "Sales and Reports" also work,
						but only for downloads and proceeds.
					</li>
					<li>
						<strong className="text-foreground">Download</strong> the .p8 file — Apple lets you
						download it exactly once. Paste its full contents below, and copy the key's{" "}
						<strong className="text-foreground">Key ID</strong> from the table.
					</li>
				</ol>
				<p className="text-foreground/80 font-semibold">Step 2 — app and vendor numbers</p>
				<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
					<li>
						App ID:{" "}
						<strong className="text-foreground">
							Apps → your app → General → App Information → Apple ID
						</strong>
						.
					</li>
					<li>
						Vendor Number:{" "}
						<strong className="text-foreground">Payments and Financial Reports</strong> — top-left
						corner, under your Legal Entity Name.
					</li>
				</ol>
				<p className="text-muted-foreground">
					After connecting, hit <strong className="text-foreground">Test</strong> to verify the key,
					then <strong className="text-foreground">Sync now</strong>. Data lands in the Revenue
					panel under "App Store"; price changes show up as flags on the main chart. Reports arrive
					daily, so new days appear every morning (US Pacific).
				</p>
			</div>
		),
	},
];

/* Payment providers live in their own table — webhook-driven, no test calls. */
const PAYMENT_PROVIDERS: ProviderMeta[] = [
	{
		type: "midtrans",
		name: "Midtrans",
		description: "Indonesian payment gateway — GoPay, QRIS, bank transfer, credit card, ShopeePay",
		icon: Wallet,
		fields: [
			{ key: "server_key", label: "Server Key", placeholder: "SB-Mid-server-...", secret: true },
			{ key: "client_key", label: "Client Key", placeholder: "SB-Mid-client-...", secret: true },
			{ key: "is_production", label: "Production Mode", placeholder: "false" },
		],
	},
	{
		type: "xendit",
		name: "Xendit",
		description: "Southeast Asian payment gateway — OVO, DANA, ShopeePay, virtual accounts",
		icon: Zap,
		fields: [
			{
				key: "secret_key",
				label: "Secret API Key",
				placeholder: "xnd_development_...",
				secret: true,
			},
			{
				key: "webhook_secret",
				label: "Webhook Secret (x-callback-token)",
				placeholder: "your-callback-token",
				secret: true,
			},
		],
	},
	{
		type: "stripe",
		name: "Stripe",
		description: "Global payments — cards, wallets, bank debits, subscriptions",
		icon: CreditCard,
		fields: [
			{
				key: "webhook_secret",
				label: "Webhook Signing Secret",
				placeholder: "whsec_...",
				secret: true,
			},
		],
	},
	{
		type: "lemonsqueezy",
		name: "LemonSqueezy",
		description: "Digital products and SaaS billing platform",
		icon: Citrus,
		fields: [
			{
				key: "webhook_secret",
				label: "Webhook Secret",
				placeholder: "your-webhook-secret",
				secret: true,
			},
		],
	},
	{
		type: "paywuz",
		name: "Paywuz",
		description: "Indonesian payment gateway — QRIS, virtual accounts, e-wallets",
		icon: Wallet,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "api.paywuz.id/v1 key", secret: true },
			{
				key: "webhook_secret",
				label: "Webhook Token (x-webhook-token)",
				placeholder: "your-webhook-token",
				secret: true,
			},
		],
	},
	{
		type: "doku",
		name: "DOKU",
		description: "Indonesian payment gateway — virtual accounts, QRIS, e-wallets, cards",
		icon: Wallet,
		fields: [
			{ key: "client_id", label: "Client ID", placeholder: "BRN-0239-1736742088036" },
			{ key: "secret_key", label: "Secret Key", placeholder: "DOKU Secret Key", secret: true },
		],
		instructions: (
			<div className="text-muted-foreground space-y-2 text-sm">
				<p className="text-foreground/80 font-semibold">Step 1 — copy your credentials</p>
				<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
					<li>
						Log in to the{" "}
						<a
							href="https://dashboard.doku.com/bo/login?utm_source=docs"
							target="_blank"
							rel="noopener noreferrer"
							className="text-foreground underline-offset-2 hover:underline"
						>
							DOKU Dashboard
						</a>
						, then open <strong className="text-foreground">Settings → Account → API Keys</strong>.
					</li>
					<li>
						Copy the <strong className="text-foreground">Client ID</strong> (format{" "}
						<code>BRN-…</code>) — the field above. For the Secret Key, click{" "}
						<strong className="text-foreground">Reveal Key</strong> and enter the 6-digit OTP sent
						to your email; the key is visible for 30 seconds.
					</li>
				</ol>
				<p className="text-foreground/80 font-semibold">
					Step 2 — register the notification URL (per payment method)
				</p>
				<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
					<li>
						In the dashboard:{" "}
						<strong className="text-foreground">Settings → Payment Settings</strong>, then select
						the payment method (Virtual Account, Cards, e-Wallet, Convenience Store, PayLater,
						Direct Debit, Digital Banking, QRIS) — each is configured separately.
					</li>
					<li>
						Set the notification URL to{" "}
						<code className="text-foreground">{`${WORKER_ORIGIN}/api/webhooks/doku`}</code> and
						save.
					</li>
				</ol>
				<p className="text-muted-foreground">
					The URL path is part of DOKU's signature, so it must match exactly. Payments arrive in the
					Revenue panel; each DOKU virtual account / payment method needs its own notification URL
					configured.
				</p>
			</div>
		),
	},
	{
		type: "mayar",
		name: "Mayar",
		description: "Indonesian payment links and invoices — QRIS, e-wallets, bank transfer",
		icon: Wallet,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "api.mayar.id/hl/v2 key", secret: true },
			{ key: "api_version", label: "API Version", placeholder: "v2" },
			{
				key: "webhook_secret",
				label: "Webhook Token (x-webhook-token)",
				placeholder: "your-webhook-token",
				secret: true,
			},
		],
	},
];

const WEBHOOK_PATHS: Record<string, string> = {
	midtrans: "/api/webhooks/midtrans",
	xendit: "/api/webhooks/xendit",
	stripe: "/api/webhooks/stripe",
	lemonsqueezy: "/api/webhooks/lemonsqueezy",
	paywuz: "/api/webhooks/paywuz",
	mayar: "/api/webhooks/mayar",
	doku: "/api/webhooks/doku",
};

const MARKETPLACES: {
	marketplace: Marketplace;
	name: string;
	description: string;
	icon: LucideIcon;
}[] = [
	{
		marketplace: "shopee",
		name: "Shopee",
		description: "Indonesian e-commerce marketplace",
		icon: ShoppingBag,
	},
	{
		marketplace: "tokopedia",
		name: "Tokopedia",
		description: "Indonesian e-commerce marketplace",
		icon: Store,
	},
];

/* --------------------------------- helpers --------------------------------- */

const syncLabel = (iso: string | null): string =>
	iso
		? new Date(iso).toLocaleString("en-GB", {
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "";

const orderMoney = (amount: number, currency: string): string =>
	Number(amount).toLocaleString("id-ID", {
		style: "currency",
		currency: currency || "IDR",
	});

const ErrText = ({ children }: { children: ReactNode }) => (
	<p className="bg-(--down)/10 text-(--down) rounded-lg px-3 py-2 text-xs">{children}</p>
);

/** Only config fields the user filled in — stored secrets come back masked. */
const filledConfig = (meta: ProviderMeta, form: Record<string, string>) => {
	const payload: Record<string, string> = {};
	for (const f of meta.fields) {
		if (form[f.key]) {
			payload[f.key] = form[f.key];
		}
	}
	return payload;
};

/* ------------------------------- config form -------------------------------- */

export const IntegrationForm = ({
	meta,
	integration,
	siteId,
	onDone,
}: {
	meta: ProviderMeta;
	integration: LegacyIntegration | null;
	siteId: string;
	onDone: () => void;
}) => {
	const qc = useQueryClient();
	const [name, setName] = useState(integration?.name ?? meta.name);
	const [form, setForm] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const f of meta.fields) {
			initial[f.key] = "";
		}
		return initial;
	});
	const [error, setError] = useState("");

	const saveMut = useMutation({
		mutationFn: async () => {
			if (integration) {
				const payload: Record<string, unknown> = { name };
				const configToUpdate = filledConfig(meta, form);
				if (Object.keys(configToUpdate).length > 0) {
					payload.config = configToUpdate;
				}
				return updateIntegration(integration.id, payload);
			}
			const payload: CreateIntegrationPayload = {
				site_id: siteId,
				type: meta.type,
				name,
				config: form,
			};
			return createIntegration(payload);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
			toast.success(integration ? "Configuration saved" : `${meta.name} connected`);
			onDone();
		},
		onError: (err: Error) => setError(err.message),
	});

	return (
		<form
			className="border-(--border) mt-2 grid gap-2 border-t pt-2"
			onSubmit={(e) => {
				e.preventDefault();
				setError("");
				saveMut.mutate();
			}}
		>
			<div className="grid gap-1">
				<Label htmlFor={`int-name-${meta.type}`} className="text-[10px]">
					Name
				</Label>
				<Input
					id={`int-name-${meta.type}`}
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={meta.name}
					className="h-8 font-mono text-xs"
				/>
			</div>
			{meta.instructions}
			{meta.fields.map((f) => (
				<div key={f.key} className="grid gap-1">
					<Label htmlFor={`int-${meta.type}-${f.key}`} className="text-[10px]">
						{f.label}
					</Label>
					{f.multiline ? (
						<Textarea
							id={`int-${meta.type}-${f.key}`}
							value={form[f.key] ?? ""}
							onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
							placeholder={integration ? "leave empty to keep current" : f.placeholder}
							className="min-h-24 font-mono text-xs"
						/>
					) : (
						<Input
							id={`int-${meta.type}-${f.key}`}
							type={f.secret ? "password" : "text"}
							value={form[f.key] ?? ""}
							onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
							placeholder={integration ? "leave empty to keep current" : f.placeholder}
							className="h-8 font-mono text-xs"
						/>
					)}
					{f.hint ? <p className="text-muted-foreground text-[10px]">{f.hint}</p> : null}
				</div>
			))}
			{error ? <ErrText>{error}</ErrText> : null}
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={saveMut.isPending}>
					{saveMut.isPending ? "Saving…" : integration ? "Save changes" : "Connect"}
				</Button>
				<Button type="button" variant="outline" size="sm" onClick={onDone}>
					Cancel
				</Button>
			</div>
		</form>
	);
};

/* -------------------------------- event log --------------------------------- */

const EventLogTable = ({ integrationId }: { integrationId: string }) => {
	const eventsQ = useQuery({
		queryFn: () => fetchWebhookEvents(integrationId),
		queryKey: ["legacy", "webhook-events", integrationId],
	});

	if (eventsQ.isLoading) {
		return <p className="text-muted-foreground py-3 text-center text-xs">Loading events…</p>;
	}
	if (eventsQ.error) {
		return <ErrText>{(eventsQ.error as Error).message}</ErrText>;
	}
	const rows = eventsQ.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground py-3 text-center text-xs">
				No events yet — webhooks and connection tests will show up here.
			</p>
		);
	}
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead>
					<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
						<th className="py-1 pr-3 font-medium">Event</th>
						<th className="py-1 pr-3 font-medium">Direction</th>
						<th className="py-1 pr-3 font-medium">Status</th>
						<th className="py-1 font-medium">Time</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((e) => (
						<tr key={e.id} className="border-(--border) border-t">
							<td className="py-1.5 pr-3 font-mono">{e.event_type}</td>
							<td className="text-muted-foreground py-1.5 pr-3">{e.direction}</td>
							<td className="py-1.5 pr-3">
								<span
									className={`font-mono text-[10px] rounded-full px-2 py-0.5 ${
										e.status === "processed"
											? "bg-(--up)/10 text-(--up)"
											: e.status === "failed"
												? "bg-(--down)/10 text-(--down)"
												: "bg-muted text-muted-foreground"
									}`}
								>
									{e.status}
								</span>
							</td>
							<td className="text-muted-foreground py-1.5 font-mono text-[10px] tabular-nums">
								{syncLabel(e.created_at)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

/* -------------------------- webhook integration card ------------------------ */

const WebhookProviderCard = ({
	meta,
	integration,
	siteId,
}: {
	meta: ProviderMeta;
	integration: LegacyIntegration | undefined;
	siteId: string;
}) => {
	const qc = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [showEvents, setShowEvents] = useState(false);
	const [test, setTest] = useState<IntegrationTestResult | null>(null);
	const [testing, setTesting] = useState(false);

	const connected = Boolean(integration);
	const enabled = integration?.enabled ?? false;
	const Icon = meta.icon;

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (!window.confirm(`Disconnect ${integration?.name ?? meta.name}?`)) {
				return null;
			}
			await deleteIntegration(integration?.id ?? "");
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
				setShowEvents(false);
				toast.success(`${meta.name} disconnected`);
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const toggleMut = useMutation({
		mutationFn: (next: boolean) => updateIntegration(integration?.id ?? "", { enabled: next }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] }),
		onError: (err: Error) => toast.error(err.message),
	});

	const syncMut = useMutation({
		mutationFn: () => syncAppStore(siteId),
		onSuccess: (r) => {
			qc.invalidateQueries({ queryKey: ["legacy", "appstore-metrics", siteId] });
			toast.success(`Synced ${r.days_synced} day(s), ${r.price_changes} price change(s) flagged`);
		},
		onError: (err: Error) => toast.error(err.message),
	});
	const runTest = async () => {
		setTesting(true);
		setTest(null);
		try {
			const result = await testIntegration(integration?.id ?? "");
			setTest(result);
			qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
			if (result.ok) {
				toast.success(result.message);
			} else {
				toast.error(result.detail ? `${result.message}: ${result.detail}` : result.message);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Test failed");
		} finally {
			setTesting(false);
		}
	};

	return (
		<Panel
			title={meta.name}
			hint={
				connected ? (
					<StatusPill on={enabled} label={enabled ? "Connected" : "Disabled"} />
				) : undefined
			}
		>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected && enabled ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Icon className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">{meta.description}</p>
			</div>
			{connected && integration?.last_sync ? (
				<p className="text-muted-foreground mt-2 font-mono text-[10px] tabular-nums">
					Last sync {syncLabel(integration.last_sync)}
				</p>
			) : null}

			{editing ? (
				<IntegrationForm
					meta={meta}
					integration={integration ?? null}
					siteId={siteId}
					onDone={() => setEditing(false)}
				/>
			) : (
				<div className="mt-2.5 flex flex-wrap items-center gap-2">
					{connected ? (
						<>
							<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
								Configure
							</Button>
							<Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
								{testing ? "Testing…" : "Test"}
							</Button>
							{meta.type === "appstoreconnect" ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() => syncMut.mutate()}
									disabled={syncMut.isPending}
								>
									{syncMut.isPending ? "Syncing…" : "Sync now"}
								</Button>
							) : null}
							<Button
								variant="outline"
								size="sm"
								onClick={() => toggleMut.mutate(!enabled)}
								disabled={toggleMut.isPending}
							>
								{enabled ? "Disable" : "Enable"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-(--down) hover:text-(--down)"
								onClick={() => deleteMut.mutate()}
								disabled={deleteMut.isPending}
							>
								<Trash2 className="size-3.5" aria-hidden />
								Disconnect
							</Button>
							<Button variant="ghost" size="sm" onClick={() => setShowEvents((v) => !v)}>
								{showEvents ? "Hide events" : "Events"}
							</Button>
						</>
					) : (
						<Button size="sm" onClick={() => setEditing(true)}>
							<Webhook className="size-3.5" aria-hidden />
							Connect
						</Button>
					)}
				</div>
			)}

			{test ? (
				<p
					className={`mt-2 rounded-lg px-3 py-2 text-xs ${
						test.ok ? "bg-(--up)/10 text-(--up)" : "bg-(--down)/10 text-(--down)"
					}`}
				>
					{test.message}
					{test.detail ? ` — ${test.detail}` : ""}
				</p>
			) : null}

			{connected && showEvents ? (
				<div className="border-(--border) mt-2 border-t pt-2">
					<p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
						Recent events
					</p>
					<EventLogTable integrationId={integration?.id ?? ""} />
				</div>
			) : null}
		</Panel>
	);
};

/* ---------------------------- payment provider card ------------------------- */

const PaymentProviderCard = ({
	meta,
	provider,
	siteId,
}: {
	meta: ProviderMeta;
	provider: { id: string; provider: string; enabled: boolean } | undefined;
	siteId: string;
}) => {
	const qc = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [form, setForm] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const f of meta.fields) {
			initial[f.key] = "";
		}
		return initial;
	});
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);

	const connected = Boolean(provider);
	const Icon = meta.icon;
	const webhookUrl = `${WORKER_ORIGIN}${WEBHOOK_PATHS[meta.type] ?? ""}`;

	const saveMut = useMutation({
		mutationFn: () => createPaymentProvider(siteId, meta.type, filledConfig(meta, form)),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "payment-providers", siteId] });
			toast.success(`${meta.name} connected`);
			setEditing(false);
		},
		onError: (err: Error) => setError(err.message),
	});

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (!window.confirm(`Disconnect ${meta.name}?`)) {
				return null;
			}
			await deletePaymentProvider(siteId, meta.type);
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "payment-providers", siteId] });
				toast.success(`${meta.name} disconnected`);
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	return (
		<Panel title={meta.name} hint={connected ? <StatusPill on label="Connected" /> : undefined}>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Icon className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">{meta.description}</p>
			</div>

			{connected ? (
				<div className="bg-muted/60 mt-2 rounded-lg px-2.5 py-2">
					<p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
						Webhook URL
					</p>
					<div className="flex items-center gap-2">
						<code className="min-w-0 flex-1 font-mono text-[10px] break-all">{webhookUrl}</code>
						<Button
							variant="outline"
							size="sm"
							className="h-6 px-2 text-[10px]"
							onClick={() => {
								navigator.clipboard.writeText(webhookUrl);
								setCopied(true);
								setTimeout(() => setCopied(false), 2000);
							}}
						>
							<Copy className="size-3" aria-hidden />
							{copied ? "Copied" : "Copy"}
						</Button>
					</div>
					<p className="text-muted-foreground mt-1 text-[10px]">
						Paste this URL in your {meta.name} dashboard webhook settings.
					</p>
				</div>
			) : null}

			{editing ? (
				<form
					className="border-(--border) mt-2 grid gap-2 border-t pt-2"
					onSubmit={(e) => {
						e.preventDefault();
						setError("");
						saveMut.mutate();
					}}
				>
					{meta.fields.map((f) => (
						<div key={f.key} className="grid gap-1">
							<Label htmlFor={`pp-${meta.type}-${f.key}`} className="text-[10px]">
								{f.label}
							</Label>
							<Input
								id={`pp-${meta.type}-${f.key}`}
								type={f.secret ? "password" : "text"}
								value={form[f.key] ?? ""}
								onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
								placeholder={f.placeholder}
								className="h-8 font-mono text-xs"
							/>
						</div>
					))}
					{error ? <ErrText>{error}</ErrText> : null}
					<div className="flex gap-2">
						<Button type="submit" size="sm" disabled={saveMut.isPending}>
							{saveMut.isPending ? "Saving…" : "Connect"}
						</Button>
						<Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
							Cancel
						</Button>
					</div>
				</form>
			) : (
				<div className="mt-2.5 flex flex-wrap items-center gap-2">
					{connected ? (
						<Button
							variant="ghost"
							size="sm"
							className="text-(--down) hover:text-(--down)"
							onClick={() => deleteMut.mutate()}
							disabled={deleteMut.isPending}
						>
							<Trash2 className="size-3.5" aria-hidden />
							Disconnect
						</Button>
					) : (
						<Button size="sm" onClick={() => setEditing(true)}>
							<Webhook className="size-3.5" aria-hidden />
							Connect
						</Button>
					)}
				</div>
			)}
		</Panel>
	);
};

/* ------------------------------ marketplace card ---------------------------- */

const OrdersTable = ({ orders }: { orders: LegacyMarketplaceOrder[] }) => (
	<div className="overflow-x-auto">
		<table className="w-full text-left text-xs">
			<thead>
				<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
					<th className="py-1 pr-3 font-medium">Order</th>
					<th className="py-1 pr-3 font-medium">Amount</th>
					<th className="py-1 pr-3 font-medium">Status</th>
					<th className="py-1 font-medium">Ordered</th>
				</tr>
			</thead>
			<tbody>
				{orders.slice(0, 20).map((o) => (
					<tr key={o.id} className="border-(--border) border-t">
						<td className="py-1.5 pr-3 font-mono">{o.order_sn}</td>
						<td className="py-1.5 pr-3 font-mono tabular-nums">
							{orderMoney(o.amount, o.currency)}
						</td>
						<td className="py-1.5 pr-3">
							<span
								className={`font-mono text-[10px] rounded-full px-2 py-0.5 ${
									o.status === "completed" || o.status === "SHIPPED"
										? "bg-(--up)/10 text-(--up)"
										: o.status === "cancelled" || o.status === "CANCELLED"
											? "bg-(--down)/10 text-(--down)"
											: "bg-muted text-muted-foreground"
								}`}
							>
								{o.status}
							</span>
						</td>
						<td className="text-muted-foreground py-1.5 font-mono text-[10px] tabular-nums">
							{syncLabel(o.ordered_at)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
		{orders.length > 20 ? (
			<p className="text-muted-foreground mt-1 text-[10px]">
				Showing 20 of {orders.length} orders.
			</p>
		) : null}
	</div>
);

const MarketplaceCard = ({
	marketplace,
	name,
	description,
	icon: Icon,
	integration,
	siteId,
}: {
	marketplace: Marketplace;
	name: string;
	description: string;
	icon: LucideIcon;
	integration: LegacyIntegration | undefined;
	siteId: string;
}) => {
	const qc = useQueryClient();
	const [showOrders, setShowOrders] = useState(false);
	const [syncing, setSyncing] = useState(false);

	const connected = Boolean(integration);

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (!window.confirm(`Disconnect ${name}?`)) {
				return null;
			}
			await deleteIntegration(integration?.id ?? "");
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
				setShowOrders(false);
				toast.success(`${name} disconnected`);
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const ordersQ = useQuery({
		enabled: showOrders && connected,
		queryFn: () => fetchMarketplaceOrders(marketplace, siteId),
		queryKey: ["legacy", "mp-orders", marketplace, siteId],
		// Sync failures/order gaps render inline below — no global toast.
		meta: { silent: true },
		retry: false,
	});

	const handleSync = async () => {
		setSyncing(true);
		try {
			await syncMarketplaceOrders(marketplace, siteId);
			qc.invalidateQueries({ queryKey: ["legacy", "mp-orders", marketplace, siteId] });
			qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
			toast.success(`${name} orders synced`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Sync failed");
		} finally {
			setSyncing(false);
		}
	};

	const connect = () => {
		window.open(marketplaceAuthUrl(marketplace, siteId), "_blank", "noopener");
	};

	return (
		<Panel title={name} hint={connected ? <StatusPill on label="Connected" /> : undefined}>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Icon className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
			</div>
			{connected && integration?.last_sync ? (
				<p className="text-muted-foreground mt-2 font-mono text-[10px] tabular-nums">
					Last sync {syncLabel(integration.last_sync)}
				</p>
			) : null}

			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={connect}>
					<ExternalLink className="size-3.5" aria-hidden />
					{connected ? "Re-authorize" : `Connect ${name}`}
				</Button>
				{connected ? (
					<>
						<Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
							<RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
							{syncing ? "Syncing…" : "Sync orders"}
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setShowOrders((v) => !v)}>
							{showOrders ? "Hide orders" : "View orders"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-(--down) hover:text-(--down)"
							onClick={() => deleteMut.mutate()}
							disabled={deleteMut.isPending}
						>
							<Trash2 className="size-3.5" aria-hidden />
							Disconnect
						</Button>
					</>
				) : null}
			</div>

			{connected && showOrders ? (
				<div className="border-(--border) mt-2 border-t pt-2">
					{ordersQ.isLoading ? (
						<p className="text-muted-foreground py-3 text-center text-xs">Loading orders…</p>
					) : ordersQ.error ? (
						<ErrText>{(ordersQ.error as Error).message}</ErrText>
					) : (ordersQ.data ?? []).length === 0 ? (
						<p className="text-muted-foreground py-3 text-center text-xs">
							No orders found. Click “Sync orders” to fetch from {name}.
						</p>
					) : (
						<OrdersTable orders={ordersQ.data ?? []} />
					)}
				</div>
			) : null}
		</Panel>
	);
};

/* --------------------------------- GSC panel -------------------------------- */

const GscPanel = ({
	integration,
	siteId,
}: {
	integration: LegacyIntegration | undefined;
	siteId: string;
}) => {
	const qc = useQueryClient();
	const [syncing, setSyncing] = useState(false);

	const connected = Boolean(integration);

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (!window.confirm("Disconnect Google Search Console?")) {
				return null;
			}
			await deleteIntegration(integration?.id ?? "");
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
				toast.success("Google Search Console disconnected");
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const handleSync = async () => {
		setSyncing(true);
		try {
			const { synced } = await syncGsc(siteId);
			qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
			qc.invalidateQueries({ queryKey: ["legacy", "gsc-queries", siteId] });
			toast.success(`Search Console synced — ${synced} day${synced === 1 ? "" : "s"} of queries`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Sync failed");
		} finally {
			setSyncing(false);
		}
	};

	const queriesQ = useQuery({
		queryFn: () => fetchGscQueries(siteId),
		queryKey: ["legacy", "gsc-queries", siteId],
		// Not-connected answers 404 — the panel shows its own inline state.
		meta: { silent: true },
		retry: false,
	});

	const rows = queriesQ.data ?? [];
	const totals = rows.reduce(
		(acc, r) => ({
			clicks: acc.clicks + r.clicks,
			impressions: acc.impressions + r.impressions,
		}),
		{ clicks: 0, impressions: 0 },
	);

	return (
		<Panel
			title="Google Search Console"
			hint={connected ? <StatusPill on label="Connected" /> : undefined}
		>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Search className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Import search query performance — clicks, impressions, CTR, and position from Google.
				</p>
			</div>
			{connected && integration?.last_sync ? (
				<p className="text-muted-foreground mt-2 font-mono text-[10px] tabular-nums">
					Last sync {syncLabel(integration.last_sync)}
				</p>
			) : null}

			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={() => window.open(gscAuthUrl(siteId), "_blank", "noopener")}>
					<ExternalLink className="size-3.5" aria-hidden />
					{connected ? "Re-authorize" : "Authorize with Google"}
				</Button>
				{connected ? (
					<>
						<Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
							<RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
							{syncing ? "Syncing…" : "Sync now"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-(--down) hover:text-(--down)"
							onClick={() => deleteMut.mutate()}
							disabled={deleteMut.isPending}
						>
							<Trash2 className="size-3.5" aria-hidden />
							Disconnect
						</Button>
					</>
				) : null}
			</div>

			<div className="border-(--border) mt-2 border-t pt-2">
				{queriesQ.isLoading ? (
					<p className="text-muted-foreground py-3 text-center text-xs">Loading queries…</p>
				) : queriesQ.error ? (
					<ErrText>{(queriesQ.error as Error).message}</ErrText>
				) : rows.length === 0 ? (
					<p className="text-muted-foreground py-3 text-center text-xs">
						No search queries yet{connected ? " — run a sync after authorizing" : ""}.
					</p>
				) : (
					<>
						<p className="text-muted-foreground mb-1.5 text-[10px]">
							Last 30 days:{" "}
							<span className="text-foreground font-mono tabular-nums">
								{totals.clicks.toLocaleString()}
							</span>{" "}
							clicks ·{" "}
							<span className="text-foreground font-mono tabular-nums">
								{totals.impressions.toLocaleString()}
							</span>{" "}
							impressions
						</p>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
										<th className="py-1 pr-3 font-medium">Query</th>
										<th className="py-1 pr-3 font-medium">Clicks</th>
										<th className="py-1 pr-3 font-medium">Impr.</th>
										<th className="py-1 pr-3 font-medium">CTR</th>
										<th className="py-1 pr-3 font-medium">Pos.</th>
										<th className="py-1 font-medium">Date</th>
									</tr>
								</thead>
								<tbody>
									{rows.slice(0, 25).map((r, i) => (
										<tr key={`${r.query}-${r.date}-${i}`} className="border-(--border) border-t">
											<td className="max-w-56 truncate py-1.5 pr-3">{r.query}</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">{r.clicks}</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">{r.impressions}</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">
												{(r.ctr * 100).toFixed(1)}%
											</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">
												{r.position.toFixed(1)}
											</td>
											<td className="text-muted-foreground py-1.5 font-mono text-[10px] tabular-nums">
												{r.date}
											</td>
										</tr>
									))}
								</tbody>
							</table>
							{rows.length > 25 ? (
								<p className="text-muted-foreground mt-1 text-[10px]">
									Showing 25 of {rows.length} rows.
								</p>
							) : null}
						</div>
					</>
				)}
			</div>
		</Panel>
	);
};

/* ----------------------------------- view ----------------------------------- */

type IntegrationsTabKey = "webhooks" | "payments" | "search" | "imports";

/**
 * Visibility gate: only providers that have actually been set up and tested
 * appear in the UI. Everything else stays defined above — re-enable by adding
 * its type here.
 */
const SHOWN_PROVIDERS: ReadonlySet<LegacyIntegrationType> = new Set([
	"appstoreconnect",
	"xendit",
	"doku",
	"paywuz",
	"mayar",
] as const);

const SECTION_TABS: readonly { readonly key: IntegrationsTabKey; readonly label: string }[] = [
	{ key: "webhooks", label: "Webhooks" },
	{ key: "payments", label: "Payments" },
	{ key: "search", label: "Search" },
	{ key: "imports", label: "Imports" },
];

export const IntegrationsView = ({ siteId }: { siteId: string }) => {
	const [tab, setTab] = useState<IntegrationsTabKey>("webhooks");

	const integrationsQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchIntegrations(siteId),
		queryKey: ["legacy", "integrations", siteId],
		retry: false,
	});
	const providersQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchPaymentProviders(siteId),
		queryKey: ["legacy", "payment-providers", siteId],
		retry: false,
	});

	const integrationByType: Partial<Record<LegacyIntegrationType, LegacyIntegration>> =
		Object.fromEntries((integrationsQ.data ?? []).map((i) => [i.type, i]));
	const paymentByProvider: Record<string, { id: string; provider: string; enabled: boolean }> =
		Object.fromEntries((providersQ.data ?? []).map((p) => [p.provider, p]));

	const errorMsg =
		integrationsQ.error instanceof Error
			? integrationsQ.error.message
			: providersQ.error instanceof Error
				? providersQ.error.message
				: "";

	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
				<div>
					<h1 className="text-lg font-semibold tracking-tight">Integrations</h1>
					<p className="text-muted-foreground text-xs">
						Webhooks, payments, marketplaces, and search data — live from your revklik account
					</p>
				</div>
				<PanelTabs tabs={SECTION_TABS} value={tab} onChange={setTab} />
			</div>

			{errorMsg ? (
				<p
					className="bg-(--down)/10 text-(--down) mb-2.5 rounded-xl px-3 py-2 text-xs"
					role="alert"
				>
					{errorMsg}
				</p>
			) : null}

			{tab === "webhooks" ? (
				<div className="grid items-start gap-2.5 md:grid-cols-2">
					{WEBHOOK_PROVIDERS.filter((meta) => SHOWN_PROVIDERS.has(meta.type)).map((meta) => (
						<WebhookProviderCard
							key={meta.type}
							meta={meta}
							integration={integrationByType[meta.type]}
							siteId={siteId}
						/>
					))}
				</div>
			) : null}

			{tab === "payments" ? (
				<div className="grid items-start gap-2.5 md:grid-cols-2">
					<div className="md:col-span-2">
						<PolarConnectPanel siteId={siteId} />
					</div>
					{PAYMENT_PROVIDERS.filter((meta) => SHOWN_PROVIDERS.has(meta.type)).map((meta) => (
						<PaymentProviderCard
							key={meta.type}
							meta={meta}
							provider={paymentByProvider[meta.type]}
							siteId={siteId}
						/>
					))}
					<Panel title="Pakasir" hint={<StatusPill on label="Built-in" />}>
						<div className="flex items-start gap-2.5">
							<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--up)/15 text-(--up)">
								<Wallet className="size-4" aria-hidden />
							</span>
							<p className="text-muted-foreground text-xs leading-relaxed">
								RevKlik's own QRIS checkout for plan payments. Verified and activated automatically
								— no per-site setup needed.
							</p>
						</div>
					</Panel>
				</div>
			) : null}

			{tab === "search" ? (
				<GscPanel integration={integrationByType.google_search_console} siteId={siteId} />
			) : null}

			{tab === "imports" ? <ImportsView siteId={siteId} /> : null}
		</main>
	);
};

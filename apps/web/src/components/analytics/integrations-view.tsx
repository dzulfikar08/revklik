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
import { Fragment, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";

import { useLocale, useT } from "@/lib/i18n";
import type { Locale, MessageKey } from "@/lib/i18n";
import { LegacyApiError } from "@/lib/legacy/api";
import {
	aggregateGscQueries,
	createIntegration,
	createPaymentProvider,
	deleteIntegration,
	deletePaymentProvider,
	fetchGscAuthUrl,
	fetchGscQueries,
	fetchIntegrations,
	fetchMarketplaceOrders,
	fetchPaymentProviders,
	fetchWebhookEvents,
	isSyncStale,
	marketplaceAuthUrl,
	SYNC_STALE_DAYS,
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

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/* ------------------------------ rich messages ------------------------------ */

type RichTags = Record<string, (inner: string) => ReactNode>;

const RICH_TAG = /<(\w+)>(.*?)<\/\1>/gu;

/**
 * Renders a message that carries inline tags (`<b>..</b>`, `<a>..</a>`): the
 * words live in the dictionary, the markup stays here.
 */
const Rich = ({ text, tags }: { text: string; tags: RichTags }) => {
	const out: ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(RICH_TAG)) {
		const [whole = "", tag = "", inner = ""] = match;
		const at = match.index ?? 0;
		if (at > last) {
			out.push(text.slice(last, at));
		}
		const render = tags[tag];
		out.push(<Fragment key={at}>{render ? render(inner) : inner}</Fragment>);
		last = at + whole.length;
	}
	if (last < text.length) {
		out.push(text.slice(last));
	}
	return <>{out}</>;
};

const BOLD: RichTags = {
	b: (inner) => <strong className="text-foreground">{inner}</strong>,
	i: (inner) => <code className="text-foreground">{inner}</code>,
};

const linkTag = (href: string, className: string) => (inner: string) => (
	<a className={className} href={href} target="_blank" rel="noopener noreferrer">
		{inner}
	</a>
);

/* ------------------------------ provider meta ------------------------------ */

interface ProviderField {
	key: string;
	/** Provider's own term (Server Key, Issuer ID, ...), shown as is. */
	label: string;
	/** Our own wording; wins over `label` when set. */
	labelKey?: MessageKey;
	placeholder: string;
	secret?: boolean;
	/** Multi-secret paste (e.g. PEM): renders a textarea instead of an input. */
	multiline?: boolean;
	/** Where to find the value, shown under the field. */
	hintKey?: MessageKey;
}

interface ProviderMeta {
	type: LegacyIntegrationType;
	name: string;
	descriptionKey: MessageKey;
	icon: LucideIcon;
	fields: ProviderField[];
	/** Step-by-step acquisition guide rendered inside the connect form. */
	Instructions?: ComponentType;
}

export const fieldLabel = (field: ProviderField, t: Translate): string =>
	field.labelKey ? t(field.labelKey) : field.label;

const AscInstructions = () => {
	const t = useT();
	const tags: RichTags = {
		...BOLD,
		a: linkTag("https://appstoreconnect.apple.com/access/integrations/api", "underline underline-offset-2"),
	};
	return (
		<div className="bg-muted/50 border-border/60 grid gap-1.5 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed">
			<p className="text-foreground/80 font-semibold">{t("integrations.asc.before")}</p>
			<p className="text-muted-foreground">{t("integrations.asc.beforeBody")}</p>
			<p className="text-foreground/80 font-semibold">{t("integrations.asc.step1")}</p>
			<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
				<li>
					<Rich text={t("integrations.asc.step1a")} tags={tags} />
				</li>
				<li>
					<Rich text={t("integrations.asc.step1b")} tags={tags} />
				</li>
				<li>
					<Rich text={t("integrations.asc.step1c")} tags={tags} />
				</li>
			</ol>
			<p className="text-foreground/80 font-semibold">{t("integrations.asc.step2")}</p>
			<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
				<li>
					<Rich text={t("integrations.asc.step2a")} tags={tags} />
				</li>
				<li>
					<Rich text={t("integrations.asc.step2b")} tags={tags} />
				</li>
			</ol>
			<p className="text-muted-foreground">
				<Rich text={t("integrations.asc.after")} tags={tags} />
			</p>
		</div>
	);
};

const DokuInstructions = () => {
	const t = useT();
	const tags: RichTags = {
		...BOLD,
		a: linkTag(
			"https://dashboard.doku.com/bo/login?utm_source=docs",
			"text-foreground underline-offset-2 hover:underline",
		),
	};
	return (
		<div className="text-muted-foreground space-y-2 text-sm">
			<p className="text-foreground/80 font-semibold">{t("integrations.doku.step1")}</p>
			<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
				<li>
					<Rich text={t("integrations.doku.step1a")} tags={tags} />
				</li>
				<li>
					<Rich text={t("integrations.doku.step1b")} tags={tags} />
				</li>
			</ol>
			<p className="text-foreground/80 font-semibold">{t("integrations.doku.step2")}</p>
			<ol className="text-muted-foreground list-decimal space-y-1 pl-4">
				<li>
					<Rich text={t("integrations.doku.step2a")} tags={tags} />
				</li>
				<li>
					<Rich
						text={t("integrations.doku.step2b", { url: `${WORKER_ORIGIN}/api/webhooks/doku` })}
						tags={tags}
					/>
				</li>
			</ol>
			<p className="text-muted-foreground">{t("integrations.doku.after")}</p>
		</div>
	);
};

/* API-key webhook integrations: configured inline, tested against the provider. */
export const WEBHOOK_PROVIDERS: ProviderMeta[] = [
	{
		type: "mailchimp",
		name: "Mailchimp",
		descriptionKey: "integrations.provider.mailchimp.desc",
		icon: Mail,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "your-mailchimp-api-key", secret: true },
			{ key: "dc", label: "Server Prefix", placeholder: "us1" },
		],
	},
	{
		type: "convertkit",
		name: "ConvertKit",
		descriptionKey: "integrations.provider.convertkit.desc",
		icon: Bird,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "your-convertkit-api-key", secret: true },
		],
	},
	{
		type: "kit",
		name: "Kit",
		descriptionKey: "integrations.provider.kit.desc",
		icon: Feather,
		fields: [{ key: "api_key", label: "API Key", placeholder: "your-kit-api-key", secret: true }],
	},
	{
		type: "beehiiv",
		name: "Beehiiv",
		descriptionKey: "integrations.provider.beehiiv.desc",
		icon: Hexagon,
		fields: [
			{ key: "api_key", label: "API Key", placeholder: "your-beehiiv-api-key", secret: true },
			{ key: "publication_id", label: "Publication ID", placeholder: "pub_..." },
		],
	},
	{
		type: "meta_ads",
		name: "Meta Ads",
		descriptionKey: "integrations.provider.meta_ads.desc",
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
		descriptionKey: "integrations.provider.google_ads.desc",
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
		descriptionKey: "integrations.provider.appstoreconnect.desc",
		icon: Apple,
		fields: [
			{
				key: "issuer_id",
				label: "Issuer ID",
				placeholder: "69a6de7c-…  (UUID)",
				hintKey: "integrations.asc.issuerHint",
			},
			{
				key: "key_id",
				label: "Key ID",
				placeholder: "ABC123DEFG",
				hintKey: "integrations.asc.keyIdHint",
			},
			{
				key: "private_key",
				label: "Private Key (.p8)",
				placeholder: "-----BEGIN PRIVATE KEY-----\nMIGT…\n-----END PRIVATE KEY-----",
				secret: true,
				multiline: true,
				hintKey: "integrations.asc.privateKeyHint",
			},
			{
				key: "app_id",
				label: "App ID (Apple ID)",
				placeholder: "123456789",
				hintKey: "integrations.asc.appIdHint",
			},
			{
				key: "vendor_number",
				label: "Vendor Number",
				placeholder: "1234567",
				hintKey: "integrations.asc.vendorHint",
			},
			{
				key: "backfill_days",
				label: "Backfill Days (optional)",
				labelKey: "integrations.field.backfillDays",
				placeholder: "30",
				hintKey: "integrations.asc.backfillHint",
			},
		],
		Instructions: AscInstructions,
	},
];

/* Payment providers live in their own table: webhook-driven, no test calls. */
const PAYMENT_PROVIDERS: ProviderMeta[] = [
	{
		type: "midtrans",
		name: "Midtrans",
		descriptionKey: "integrations.provider.midtrans.desc",
		icon: Wallet,
		fields: [
			{ key: "server_key", label: "Server Key", placeholder: "SB-Mid-server-...", secret: true },
			{ key: "client_key", label: "Client Key", placeholder: "SB-Mid-client-...", secret: true },
			{
				key: "is_production",
				label: "Production Mode",
				labelKey: "integrations.field.isProduction",
				placeholder: "false",
			},
		],
	},
	{
		type: "xendit",
		name: "Xendit",
		descriptionKey: "integrations.provider.xendit.desc",
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
		descriptionKey: "integrations.provider.stripe.desc",
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
		descriptionKey: "integrations.provider.lemonsqueezy.desc",
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
		descriptionKey: "integrations.provider.paywuz.desc",
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
		descriptionKey: "integrations.provider.doku.desc",
		icon: Wallet,
		fields: [
			{ key: "client_id", label: "Client ID", placeholder: "BRN-0239-1736742088036" },
			{ key: "secret_key", label: "Secret Key", placeholder: "DOKU Secret Key", secret: true },
		],
		Instructions: DokuInstructions,
	},
	{
		type: "mayar",
		name: "Mayar",
		descriptionKey: "integrations.provider.mayar.desc",
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

/**
 * Shopee and Tokopedia are not offered yet. The cards below stay built and
 * translated; flip this to render them in the Payments tab.
 */
const MARKETPLACES_ENABLED = false;

const MARKETPLACES: {
	marketplace: Marketplace;
	name: string;
	icon: LucideIcon;
}[] = [
	{ marketplace: "shopee", name: "Shopee", icon: ShoppingBag },
	{ marketplace: "tokopedia", name: "Tokopedia", icon: Store },
];

/* --------------------------------- helpers --------------------------------- */

const intlLocale = (locale: Locale): string => (locale === "id" ? "id-ID" : "en-GB");

const syncLabel = (iso: string | null, locale: Locale): string =>
	iso
		? new Date(iso).toLocaleString(intlLocale(locale), {
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

/** Only config fields the user filled in: stored secrets come back masked. */
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
	const t = useT();
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
			toast.success(
				integration ? t("integrations.configSaved") : t("integrations.connected", { name: meta.name }),
			);
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
					{t("integrations.name")}
				</Label>
				<Input
					id={`int-name-${meta.type}`}
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={meta.name}
					className="h-8 font-mono text-xs"
				/>
			</div>
			{meta.Instructions ? <meta.Instructions /> : null}
			{meta.fields.map((f) => (
				<div key={f.key} className="grid gap-1">
					<Label htmlFor={`int-${meta.type}-${f.key}`} className="text-[10px]">
						{fieldLabel(f, t)}
					</Label>
					{f.multiline ? (
						<Textarea
							id={`int-${meta.type}-${f.key}`}
							value={form[f.key] ?? ""}
							onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
							placeholder={integration ? t("integrations.keepCurrent") : f.placeholder}
							className="min-h-24 font-mono text-xs"
						/>
					) : (
						<Input
							id={`int-${meta.type}-${f.key}`}
							type={f.secret ? "password" : "text"}
							value={form[f.key] ?? ""}
							onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
							placeholder={integration ? t("integrations.keepCurrent") : f.placeholder}
							className="h-8 font-mono text-xs"
						/>
					)}
					{f.hintKey ? <p className="text-muted-foreground text-[10px]">{t(f.hintKey)}</p> : null}
				</div>
			))}
			{error ? <ErrText>{error}</ErrText> : null}
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={saveMut.isPending}>
					{saveMut.isPending
						? t("integrations.saving")
						: integration
							? t("integrations.saveChanges")
							: t("integrations.connect")}
				</Button>
				<Button type="button" variant="outline" size="sm" onClick={onDone}>
					{t("integrations.cancel")}
				</Button>
			</div>
		</form>
	);
};

/* -------------------------------- event log --------------------------------- */

const EventLogTable = ({ integrationId }: { integrationId: string }) => {
	const t = useT();
	const locale = useLocale();
	const eventsQ = useQuery({
		queryFn: () => fetchWebhookEvents(integrationId),
		queryKey: ["legacy", "webhook-events", integrationId],
	});

	if (eventsQ.isLoading) {
		return (
			<p className="text-muted-foreground py-3 text-center text-xs">
				{t("integrations.events.loading")}
			</p>
		);
	}
	if (eventsQ.error) {
		return <ErrText>{(eventsQ.error as Error).message}</ErrText>;
	}
	const rows = eventsQ.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground py-3 text-center text-xs">
				{t("integrations.events.empty")}
			</p>
		);
	}
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead>
					<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
						<th className="py-1 pr-3 font-medium">{t("integrations.events.event")}</th>
						<th className="py-1 pr-3 font-medium">{t("integrations.events.direction")}</th>
						<th className="py-1 pr-3 font-medium">{t("integrations.events.status")}</th>
						<th className="py-1 font-medium">{t("integrations.events.time")}</th>
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
								{syncLabel(e.created_at, locale)}
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
	const t = useT();
	const locale = useLocale();
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
			if (
				!window.confirm(
					t("integrations.disconnectConfirm", { name: integration?.name ?? meta.name }),
				)
			) {
				return null;
			}
			await deleteIntegration(integration?.id ?? "");
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
				setShowEvents(false);
				toast.success(t("integrations.disconnected", { name: meta.name }));
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
			toast.success(
				t("integrations.asc.synced", { changes: r.price_changes, days: r.days_synced }),
			);
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
				toast.error(
					result.detail
						? t("integrations.testDetail", { detail: result.detail, message: result.message })
						: result.message,
				);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("integrations.testFailed"));
		} finally {
			setTesting(false);
		}
	};

	return (
		<Panel
			title={meta.name}
			hint={
				connected ? (
					<StatusPill
						on={enabled}
						label={enabled ? t("integrations.status.connected") : t("integrations.status.disabled")}
					/>
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
				<p className="text-muted-foreground text-xs leading-relaxed">{t(meta.descriptionKey)}</p>
			</div>
			{connected && integration?.last_sync ? (
				<p className="text-muted-foreground mt-2 font-mono text-[10px] tabular-nums">
					{t("integrations.lastSync", { when: syncLabel(integration.last_sync, locale) })}
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
								{t("integrations.configure")}
							</Button>
							<Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
								{testing ? t("integrations.testing") : t("integrations.test")}
							</Button>
							{meta.type === "appstoreconnect" ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() => syncMut.mutate()}
									disabled={syncMut.isPending}
								>
									{syncMut.isPending ? t("integrations.syncing") : t("integrations.syncNow")}
								</Button>
							) : null}
							<Button
								variant="outline"
								size="sm"
								onClick={() => toggleMut.mutate(!enabled)}
								disabled={toggleMut.isPending}
							>
								{enabled ? t("integrations.disable") : t("integrations.enable")}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-(--down) hover:text-(--down)"
								onClick={() => deleteMut.mutate()}
								disabled={deleteMut.isPending}
							>
								<Trash2 className="size-3.5" aria-hidden />
								{t("integrations.disconnect")}
							</Button>
							<Button variant="ghost" size="sm" onClick={() => setShowEvents((v) => !v)}>
								{showEvents ? t("integrations.events.hide") : t("integrations.events.show")}
							</Button>
						</>
					) : (
						<Button size="sm" onClick={() => setEditing(true)}>
							<Webhook className="size-3.5" aria-hidden />
							{t("integrations.connect")}
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
					{test.detail
						? t("integrations.testDetail", { detail: test.detail, message: test.message })
						: test.message}
				</p>
			) : null}

			{connected && showEvents ? (
				<div className="border-(--border) mt-2 border-t pt-2">
					<p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
						{t("integrations.events.recent")}
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
	const t = useT();
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
			toast.success(t("integrations.connected", { name: meta.name }));
			setEditing(false);
		},
		onError: (err: Error) => setError(err.message),
	});

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (!window.confirm(t("integrations.disconnectConfirm", { name: meta.name }))) {
				return null;
			}
			await deletePaymentProvider(siteId, meta.type);
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "payment-providers", siteId] });
				toast.success(t("integrations.disconnected", { name: meta.name }));
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	return (
		<Panel
			title={meta.name}
			hint={connected ? <StatusPill on label={t("integrations.status.connected")} /> : undefined}
		>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Icon className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">{t(meta.descriptionKey)}</p>
			</div>

			{connected ? (
				<div className="bg-muted/60 mt-2 rounded-lg px-2.5 py-2">
					<p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
						{t("integrations.webhookUrl")}
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
							{copied ? t("integrations.copied") : t("integrations.copy")}
						</Button>
					</div>
					<p className="text-muted-foreground mt-1 text-[10px]">
						{t("integrations.webhookUrlHint", { name: meta.name })}
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
					{meta.Instructions ? <meta.Instructions /> : null}
					{meta.fields.map((f) => (
						<div key={f.key} className="grid gap-1">
							<Label htmlFor={`pp-${meta.type}-${f.key}`} className="text-[10px]">
								{fieldLabel(f, t)}
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
							{saveMut.isPending ? t("integrations.saving") : t("integrations.connect")}
						</Button>
						<Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
							{t("integrations.cancel")}
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
							{t("integrations.disconnect")}
						</Button>
					) : (
						<Button size="sm" onClick={() => setEditing(true)}>
							<Webhook className="size-3.5" aria-hidden />
							{t("integrations.connect")}
						</Button>
					)}
				</div>
			)}
		</Panel>
	);
};

/* ------------------------------ marketplace card ---------------------------- */

const OrdersTable = ({ orders }: { orders: LegacyMarketplaceOrder[] }) => {
	const t = useT();
	const locale = useLocale();
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead>
					<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
						<th className="py-1 pr-3 font-medium">{t("integrations.marketplace.order")}</th>
						<th className="py-1 pr-3 font-medium">{t("integrations.marketplace.amount")}</th>
						<th className="py-1 pr-3 font-medium">{t("integrations.marketplace.status")}</th>
						<th className="py-1 font-medium">{t("integrations.marketplace.ordered")}</th>
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
								{syncLabel(o.ordered_at, locale)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{orders.length > 20 ? (
				<p className="text-muted-foreground mt-1 text-[10px]">
					{t("integrations.marketplace.showing", { n: orders.length })}
				</p>
			) : null}
		</div>
	);
};

const MarketplaceCard = ({
	marketplace,
	name,
	icon: Icon,
	integration,
	siteId,
}: {
	marketplace: Marketplace;
	name: string;
	icon: LucideIcon;
	integration: LegacyIntegration | undefined;
	siteId: string;
}) => {
	const t = useT();
	const locale = useLocale();
	const qc = useQueryClient();
	const [showOrders, setShowOrders] = useState(false);
	const [syncing, setSyncing] = useState(false);

	const connected = Boolean(integration);

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (!window.confirm(t("integrations.disconnectConfirm", { name }))) {
				return null;
			}
			await deleteIntegration(integration?.id ?? "");
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
				setShowOrders(false);
				toast.success(t("integrations.disconnected", { name }));
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const ordersQ = useQuery({
		enabled: showOrders && connected,
		queryFn: () => fetchMarketplaceOrders(marketplace, siteId),
		queryKey: ["legacy", "mp-orders", marketplace, siteId],
		// Sync failures/order gaps render inline below: no global toast.
		meta: { silent: true },
		retry: false,
	});

	const handleSync = async () => {
		setSyncing(true);
		try {
			await syncMarketplaceOrders(marketplace, siteId);
			qc.invalidateQueries({ queryKey: ["legacy", "mp-orders", marketplace, siteId] });
			qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
			toast.success(t("integrations.marketplace.synced", { name }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("integrations.syncFailed"));
		} finally {
			setSyncing(false);
		}
	};

	const connect = () => {
		window.open(marketplaceAuthUrl(marketplace, siteId), "_blank", "noopener");
	};

	return (
		<Panel
			title={name}
			hint={connected ? <StatusPill on label={t("integrations.status.connected")} /> : undefined}
		>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Icon className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{t("integrations.marketplace.desc")}
				</p>
			</div>
			{connected && integration?.last_sync ? (
				<p className="text-muted-foreground mt-2 font-mono text-[10px] tabular-nums">
					{t("integrations.lastSync", { when: syncLabel(integration.last_sync, locale) })}
				</p>
			) : null}

			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={connect}>
					<ExternalLink className="size-3.5" aria-hidden />
					{connected ? t("integrations.reauthorize") : t("integrations.connectName", { name })}
				</Button>
				{connected ? (
					<>
						<Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
							<RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
							{syncing ? t("integrations.syncing") : t("integrations.marketplace.syncOrders")}
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setShowOrders((v) => !v)}>
							{showOrders
								? t("integrations.marketplace.hideOrders")
								: t("integrations.marketplace.viewOrders")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-(--down) hover:text-(--down)"
							onClick={() => deleteMut.mutate()}
							disabled={deleteMut.isPending}
						>
							<Trash2 className="size-3.5" aria-hidden />
							{t("integrations.disconnect")}
						</Button>
					</>
				) : null}
			</div>

			{connected && showOrders ? (
				<div className="border-(--border) mt-2 border-t pt-2">
					{ordersQ.isLoading ? (
						<p className="text-muted-foreground py-3 text-center text-xs">
							{t("integrations.marketplace.loading")}
						</p>
					) : ordersQ.error ? (
						<ErrText>{(ordersQ.error as Error).message}</ErrText>
					) : (ordersQ.data ?? []).length === 0 ? (
						<p className="text-muted-foreground py-3 text-center text-xs">
							{t("integrations.marketplace.empty", { name })}
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

const GSC_ROWS_SHOWN = 25;

/** The auth-url route answers 403 to anyone who is not an admin or owner of the site. */
const gscAuthError = (err: unknown, t: Translate): string => {
	if (err instanceof LegacyApiError && err.status === 403) {
		return t("integrations.gsc.authAdminOnly");
	}
	return err instanceof Error && err.message ? err.message : t("integrations.gsc.authFailed");
};

const GscPanel = ({
	integration,
	siteId,
}: {
	integration: LegacyIntegration | undefined;
	siteId: string;
}) => {
	const t = useT();
	const locale = useLocale();
	const qc = useQueryClient();
	const [syncing, setSyncing] = useState(false);
	const [authorizing, setAuthorizing] = useState(false);

	const connected = Boolean(integration);
	const lastSync = integration?.last_sync ?? null;
	const stale = connected && isSyncStale(lastSync);

	const deleteMut = useMutation({
		mutationFn: async () => {
			if (
				!window.confirm(
					t("integrations.disconnectConfirm", { name: t("integrations.gsc.disconnectName") }),
				)
			) {
				return null;
			}
			await deleteIntegration(integration?.id ?? "");
			return true;
		},
		onSuccess: (deleted) => {
			if (deleted) {
				qc.invalidateQueries({ queryKey: ["legacy", "integrations", siteId] });
				toast.success(
					t("integrations.disconnected", { name: t("integrations.gsc.disconnectName") }),
				);
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
			toast.success(t("integrations.gsc.synced", { n: synced }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("integrations.syncFailed"));
		} finally {
			setSyncing(false);
		}
	};

	const handleAuthorize = async () => {
		setAuthorizing(true);
		try {
			const { url } = await fetchGscAuthUrl(siteId);
			if (!url) {
				throw new Error(t("integrations.gsc.authFailed"));
			}
			// The page is replaced by Google's consent screen; keep the button busy until then.
			window.location.assign(url);
		} catch (err) {
			toast.error(gscAuthError(err, t));
			setAuthorizing(false);
		}
	};

	const queriesQ = useQuery({
		queryFn: () => fetchGscQueries(siteId),
		queryKey: ["legacy", "gsc-queries", siteId],
		// Not-connected answers 404: the panel shows its own inline state.
		meta: { silent: true },
		retry: false,
	});

	const queries = aggregateGscQueries(queriesQ.data ?? []);
	const totals = queries.reduce(
		(acc, q) => ({
			clicks: acc.clicks + q.clicks,
			impressions: acc.impressions + q.impressions,
		}),
		{ clicks: 0, impressions: 0 },
	);

	const numberFmt = new Intl.NumberFormat(intlLocale(locale));
	const percentFmt = new Intl.NumberFormat(intlLocale(locale), {
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
		style: "percent",
	});
	const positionFmt = new Intl.NumberFormat(intlLocale(locale), {
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
	});

	return (
		<Panel
			title="Google Search Console"
			hint={connected ? <StatusPill on label={t("integrations.status.connected")} /> : undefined}
		>
			<div className="flex items-start gap-2.5">
				<span
					className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
						connected ? "bg-(--up)/15 text-(--up)" : "bg-muted text-muted-foreground"
					}`}
				>
					<Search className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">{t("integrations.gsc.desc")}</p>
			</div>
			{connected && lastSync ? (
				<p className="text-muted-foreground mt-2 font-mono text-[10px] tabular-nums">
					{t("integrations.lastSync", { when: syncLabel(lastSync, locale) })}
				</p>
			) : null}
			{stale && lastSync ? (
				<p
					className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
					role="status"
				>
					{t("integrations.gsc.stale", {
						days: SYNC_STALE_DAYS,
						when: syncLabel(lastSync, locale),
					})}
				</p>
			) : null}

			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={handleAuthorize} disabled={authorizing}>
					<ExternalLink className="size-3.5" aria-hidden />
					{connected ? t("integrations.reauthorize") : t("integrations.authorizeGoogle")}
				</Button>
				{connected ? (
					<>
						<Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
							<RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
							{syncing ? t("integrations.syncing") : t("integrations.syncNow")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-(--down) hover:text-(--down)"
							onClick={() => deleteMut.mutate()}
							disabled={deleteMut.isPending}
						>
							<Trash2 className="size-3.5" aria-hidden />
							{t("integrations.disconnect")}
						</Button>
					</>
				) : null}
			</div>

			<div className="border-(--border) mt-2 border-t pt-2">
				{queriesQ.isLoading ? (
					<p className="text-muted-foreground py-3 text-center text-xs">
						{t("integrations.gsc.loading")}
					</p>
				) : queriesQ.error ? (
					<ErrText>{(queriesQ.error as Error).message}</ErrText>
				) : queries.length === 0 ? (
					<p className="text-muted-foreground py-3 text-center text-xs">
						{connected ? t("integrations.gsc.emptyConnected") : t("integrations.gsc.empty")}
					</p>
				) : (
					<>
						<p className="text-muted-foreground mb-1.5 text-[10px]">
							{t("integrations.gsc.totals", {
								clicks: numberFmt.format(totals.clicks),
								impressions: numberFmt.format(totals.impressions),
							})}
						</p>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
										<th className="py-1 pr-3 font-medium">{t("integrations.gsc.query")}</th>
										<th className="py-1 pr-3 font-medium">{t("integrations.gsc.clicks")}</th>
										<th className="py-1 pr-3 font-medium">{t("integrations.gsc.impressions")}</th>
										<th className="py-1 pr-3 font-medium">{t("integrations.gsc.ctr")}</th>
										<th className="py-1 font-medium">{t("integrations.gsc.position")}</th>
									</tr>
								</thead>
								<tbody>
									{queries.slice(0, GSC_ROWS_SHOWN).map((q) => (
										<tr key={q.query} className="border-(--border) border-t">
											<td className="max-w-56 truncate py-1.5 pr-3">{q.query}</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">
												{numberFmt.format(q.clicks)}
											</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">
												{numberFmt.format(q.impressions)}
											</td>
											<td className="py-1.5 pr-3 font-mono tabular-nums">
												{percentFmt.format(q.ctr)}
											</td>
											<td className="py-1.5 font-mono tabular-nums">{positionFmt.format(q.position)}</td>
										</tr>
									))}
								</tbody>
							</table>
							{queries.length > GSC_ROWS_SHOWN ? (
								<p className="text-muted-foreground mt-1 text-[10px]">
									{t("integrations.gsc.showing", { n: queries.length, shown: GSC_ROWS_SHOWN })}
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

type IntegrationsTabKey = "payments" | "apps" | "search" | "imports";

/**
 * Visibility gate: only providers that have actually been set up and tested
 * appear in the UI. Everything else stays defined above: re-enable by adding
 * its type here.
 */
const SHOWN_PROVIDERS: ReadonlySet<LegacyIntegrationType> = new Set([
	"appstoreconnect",
	"xendit",
	"doku",
	"paywuz",
	"mayar",
] as const);

export const IntegrationsView = ({ siteId }: { siteId: string }) => {
	const t = useT();
	const [tab, setTab] = useState<IntegrationsTabKey>("payments");

	const tabs: readonly { readonly key: IntegrationsTabKey; readonly label: string }[] = [
		{ key: "payments", label: t("integrations.tab.payments") },
		{ key: "apps", label: t("integrations.tab.apps") },
		{ key: "search", label: t("integrations.tab.search") },
		{ key: "imports", label: t("integrations.tab.imports") },
	];

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
					<h1 className="text-lg font-semibold tracking-tight">{t("integrations.title")}</h1>
					<p className="text-muted-foreground text-xs">{t("integrations.subtitle")}</p>
				</div>
				<PanelTabs tabs={tabs} value={tab} onChange={setTab} />
			</div>

			{errorMsg ? (
				<p
					className="bg-(--down)/10 text-(--down) mb-2.5 rounded-xl px-3 py-2 text-xs"
					role="alert"
				>
					{errorMsg}
				</p>
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
					{MARKETPLACES_ENABLED
						? MARKETPLACES.map((m) => (
								<MarketplaceCard
									key={m.marketplace}
									marketplace={m.marketplace}
									name={m.name}
									icon={m.icon}
									integration={integrationByType[m.marketplace]}
									siteId={siteId}
								/>
							))
						: null}
				</div>
			) : null}

			{tab === "apps" ? (
				<>
					<p className="text-muted-foreground mb-2.5 text-xs">{t("integrations.apps.intro")}</p>
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
				</>
			) : null}

			{tab === "search" ? (
				<GscPanel integration={integrationByType.google_search_console} siteId={siteId} />
			) : null}

			{tab === "imports" ? <ImportsView siteId={siteId} /> : null}
		</main>
	);
};

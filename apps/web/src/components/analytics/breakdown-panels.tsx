import { useQuery } from "@tanstack/react-query";
import { FileText, Globe } from "lucide-react";
import { useMemo, useState } from "react";

import { useLocale, useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { fetchAppStoreMetrics } from "@/lib/legacy/appstoreconnect";
import { CITY_COORDS, countryFlag, fetchCampaigns, fetchGeo } from "@/lib/legacy/api";
import type { GeoRow, LegacyFilter, SiteDashboard } from "@/lib/legacy/api";

import { aggregateGeo, countryName, deviceGlyph, NEUTRAL_GLYPH } from "./dashboard-mapping";
import { fmt, fmtC, fmtPct, money } from "./data";
import type { RangeKey } from "./data";
import { isFilterOn } from "./filter-model";
import { EmptyBlock, PanelState } from "./panel-state";
import { paymentMethodLabel, paymentProviderLabel } from "./payment-labels";
import { CountBarRow, GlobePanel, Panel, PanelTabs, PlatformGlyph, SortHint } from "./ui";

/** Six 36px rows and their gaps; a coarse pointer gets 44px rows. */
const RANK_BOX = "h-60 pointer-coarse:h-72 overflow-y-auto";
const NO_ROWS: GeoRow[] = [];

export interface FilterHandle {
	filters: LegacyFilter[];
	onToggle: (dimension: string, value: string) => void;
}

export interface DashState {
	dash: SiteDashboard | undefined;
	loading: boolean;
	error: unknown;
	retrying: boolean;
	onRetry: () => void;
}

/** What the empty state offers: a wider range, when one exists. */
export interface WidenAction {
	label: string;
	onClick: () => void;
}

interface RankItem {
	key: string;
	label: string;
	amount: number;
	display: string;
	note?: string;
	glyph?: React.ReactNode;
	/** Filter this row toggles; absent when the API cannot filter on the dimension. */
	filter?: { dimension: string; value: string };
}

const Flag = ({ code }: { code: string }) => (
	<span className="text-[15px] leading-none" aria-hidden>
		{countryFlag(code) || "🌐"}
	</span>
);

const RankRows = ({
	items,
	fill,
	handle,
}: {
	items: RankItem[];
	fill?: string;
	handle: FilterHandle;
}) => {
	const t = useT();
	const total = items.reduce((sum, i) => sum + Math.max(i.amount, 0), 0);
	return (
		<div className="grid gap-1">
			{items.map((i) => {
				const f = i.filter;
				return (
					<CountBarRow
						key={i.key}
						glyph={i.glyph}
						label={i.label}
						value={i.display}
						note={i.note}
						share={total > 0 ? (Math.max(i.amount, 0) / total) * 100 : 0}
						fill={fill}
						selected={f ? isFilterOn(handle.filters, f.dimension, f.value) : false}
						onSelect={f ? () => handle.onToggle(f.dimension, f.value) : undefined}
						selectLabel={f ? t("filter.by", { label: i.label }) : undefined}
					/>
				);
			})}
		</div>
	);
};

const sortItems = (items: RankItem[], dir: "desc" | "asc"): RankItem[] =>
	items.toSorted((a, b) => (dir === "desc" ? b.amount - a.amount : a.amount - b.amount));

const salesNote = (t: ReturnType<typeof useT>, n: number): string => t("rev.sales", { n });

/* ------------------------------ where buyers come from ---------------------- */

type BuyersTab = "source" | "channel" | "campaign" | "country" | "payment" | "appstore";
type PaymentView = "method" | "provider";

export const BuyersPanel = ({
	state,
	handle,
	siteId,
	rangeKey,
	filterStr,
	widen,
}: {
	state: DashState;
	handle: FilterHandle;
	siteId: string;
	rangeKey: RangeKey;
	filterStr: string;
	widen?: WidenAction;
}) => {
	const t = useT();
	const locale = useLocale();
	const { dash } = state;
	const [tab, setTab] = useState<BuyersTab>("source");
	const [paymentView, setPaymentView] = useState<PaymentView>("method");
	const currency = dash?.currency;

	const campaignsQ = useQuery({
		enabled: Boolean(siteId) && tab === "campaign",
		meta: { silent: true },
		queryFn: () => fetchCampaigns(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "campaigns", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const ascQ = useQuery({
		enabled: Boolean(siteId) && tab === "appstore",
		meta: { silent: true },
		queryFn: () => fetchAppStoreMetrics(siteId, rangeKey),
		queryKey: ["legacy", "appstore-metrics", siteId, rangeKey],
		retry: false,
		staleTime: 60_000,
	});

	const items = useMemo((): RankItem[] => {
		if (!dash) {
			return [];
		}
		const withSales = (conversions: number): string | undefined =>
			conversions > 0 ? t("rev.sales", { n: conversions }) : undefined;
		switch (tab) {
			case "source":
				return dash.revenueBySource.map((r) => ({
					amount: r.revenue,
					display: money(r.revenue, currency),
					filter: { dimension: "source", value: r.source },
					key: r.source,
					label: r.source,
					note: withSales(r.conversions),
				}));
			case "channel":
				return dash.channels
					.filter((c) => c.revenue > 0)
					.map((c) => ({
						amount: c.revenue,
						display: money(c.revenue, currency),
						key: c.channel,
						label: c.channel,
					}));
			case "country":
				return dash.revenueByCountry.map((r) => ({
					amount: r.revenue,
					display: money(r.revenue, currency),
					filter: { dimension: "country", value: r.country },
					glyph: <Flag code={r.country} />,
					key: r.country,
					label: countryName(r.country, locale),
					note: withSales(r.conversions),
				}));
			case "payment":
				return paymentView === "provider"
					? dash.revenueByProvider.map((r) => ({
							amount: r.revenue,
							display: money(r.revenue, currency),
							key: r.provider,
							label: paymentProviderLabel(r.provider),
							note: withSales(r.count),
						}))
					: dash.revenueByMethod.map((r) => ({
							amount: r.revenue,
							display: money(r.revenue, currency),
							key: r.method,
							label: paymentMethodLabel(r.method),
							note: withSales(r.count),
						}));
			case "campaign":
				return (campaignsQ.data ?? [])
					.filter((c) => c.revenue > 0 || c.visitors > 0)
					.map((c) => ({
						amount: c.revenue,
						display: money(c.revenue, currency),
						filter: c.utm_campaign
							? { dimension: "utm_campaign", value: c.utm_campaign }
							: undefined,
						key: `${c.utm_source}-${c.utm_medium}-${c.utm_campaign}`,
						label: c.utm_campaign || t("rev.noCampaign"),
						note: t("rev.campaignNote", {
							rate: fmtPct(c.conversionRate).replace("+", ""),
							visitors: fmt(c.visitors),
						}),
					}));
			default:
				return (ascQ.data?.byCountry ?? []).map((r) => ({
					amount: r.proceeds,
					display: money(r.proceeds),
					glyph: <Flag code={r.country} />,
					key: r.country,
					label: countryName(r.country, locale),
				}));
		}
	}, [dash, tab, paymentView, campaignsQ.data, ascQ.data, currency, locale, t]);

	const sorted = useMemo(() => sortItems(items, "desc"), [items]);

	let loading = state.loading;
	let error = state.error;
	let retry = state.onRetry;
	let retrying = state.retrying;
	if (tab === "campaign") {
		loading = state.loading || campaignsQ.isLoading;
		error = state.error ?? campaignsQ.error;
		retry = state.error ? state.onRetry : () => void campaignsQ.refetch();
		retrying = state.retrying || campaignsQ.isFetching;
	} else if (tab === "appstore") {
		loading = state.loading || ascQ.isLoading;
		// No App Store Connect integration on the site is a 404 and means "nothing to show".
		error = undefined;
	}

	const emptyKey: Record<BuyersTab, MessageKey> = {
		appstore: "rev.emptyAppStore",
		campaign: "rev.emptyCampaign",
		channel: "rev.empty",
		country: "rev.empty",
		payment: "dash.payment.empty",
		source: "rev.empty",
	};

	const tabs = [
		{ key: "source" as const, label: t("rev.tab.source") },
		{ key: "channel" as const, label: t("rev.tab.channel") },
		{ key: "campaign" as const, label: t("rev.tab.campaign") },
		{ key: "country" as const, label: t("rev.tab.country") },
		{ key: "payment" as const, label: t("dash.payment.tab") },
		{ key: "appstore" as const, label: "App Store" },
	];

	return (
		<Panel
			title={t("home.buyers.title")}
			hint={
				tab === "appstore" ? undefined : (
					<span className="hidden sm:inline">{t("filter.rowHint")}</span>
				)
			}
		>
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<PanelTabs tabs={tabs} value={tab} onChange={setTab} label={t("home.buyers.title")} />
				{tab === "payment" ? (
					<PanelTabs
						value={paymentView}
						onChange={setPaymentView}
						label={t("dash.payment.tab")}
						tabs={[
							{ key: "method", label: t("dash.payment.method") },
							{ key: "provider", label: t("dash.payment.provider") },
						]}
					/>
				) : null}
			</div>
			<PanelState
				loading={loading}
				error={error}
				onRetry={retry}
				retrying={retrying}
				hasData={sorted.length > 0}
				emptyText={t(emptyKey[tab])}
				emptyAction={widen}
				boxClass={RANK_BOX}
			>
				<RankRows items={sorted} fill="var(--money)" handle={handle} />
			</PanelState>
		</Panel>
	);
};

/* -------------------------------- what sells -------------------------------- */

type SellsTab = "revenue" | "views" | "exit";

export const SellsPanel = ({
	state,
	handle,
	widen,
}: {
	state: DashState;
	handle: FilterHandle;
	widen?: WidenAction;
}) => {
	const t = useT();
	const { dash } = state;
	const hasRevenue = (dash?.entryPagesRevenue ?? []).some((p) => p.revenue > 0);
	// Until the owner picks a tab, follow the data: revenue pages when there are sales, else views.
	const [picked, setPicked] = useState<SellsTab | null>(null);
	const tab: SellsTab = picked ?? (hasRevenue || !dash ? "revenue" : "views");
	const currency = dash?.currency;

	const items = useMemo((): RankItem[] => {
		const glyph = <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />;
		if (!dash) {
			return [];
		}
		if (tab === "revenue") {
			return dash.entryPagesRevenue
				.filter((p) => p.revenue > 0)
				.map((p) => ({
					amount: p.revenue,
					display: money(p.revenue, currency),
					filter: { dimension: "entry_path", value: p.path },
					glyph,
					key: p.path,
					label: p.path,
					note: p.conversions > 0 ? t("rev.sales", { n: p.conversions }) : undefined,
				}));
		}
		if (tab === "views") {
			return dash.topPages.map((p) => ({
				amount: p.pageviews,
				display: fmtC(p.pageviews),
				filter: { dimension: "path", value: p.path },
				glyph,
				key: p.path,
				label: p.path,
			}));
		}
		return dash.exitPages.map((p) => ({
			amount: p.exits,
			display: fmtC(p.exits),
			filter: { dimension: "path", value: p.path },
			glyph,
			key: p.path,
			label: p.path,
		}));
	}, [dash, tab, currency, t]);

	return (
		<Panel title={t("home.sells.title")}>
			<div className="mb-2">
				<PanelTabs
					value={tab}
					onChange={setPicked}
					label={t("home.sells.title")}
					tabs={[
						{ key: "revenue", label: t("sells.tab.revenue") },
						{ key: "views", label: t("sells.tab.views") },
						{ key: "exit", label: t("sells.tab.exit") },
					]}
				/>
			</div>
			<PanelState
				loading={state.loading}
				error={state.error}
				onRetry={state.onRetry}
				retrying={state.retrying}
				hasData={items.length > 0}
				emptyText={t(tab === "revenue" ? "sells.emptyRevenue" : "sells.emptyViews")}
				emptyAction={widen}
				boxClass={RANK_BOX}
			>
				<RankRows
					items={items}
					fill={tab === "revenue" ? "var(--money)" : undefined}
					handle={handle}
				/>
			</PanelState>
		</Panel>
	);
};

/* ----------------------------- traffic: sources ----------------------------- */

type SourceTab = "referrer" | "channel";

export const SourcesPanel = ({
	state,
	handle,
	widen,
}: {
	state: DashState;
	handle: FilterHandle;
	widen?: WidenAction;
}) => {
	const t = useT();
	const { dash } = state;
	const [tab, setTab] = useState<SourceTab>("referrer");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const items = useMemo((): RankItem[] => {
		const glyph = <Globe className="text-muted-foreground size-4 shrink-0" aria-hidden />;
		const raw: RankItem[] =
			tab === "channel"
				? (dash?.channels ?? []).map((c) => ({
						amount: c.visitors,
						display: fmtC(c.visitors),
						glyph,
						key: c.channel,
						label: c.channel,
					}))
				: (dash?.sources ?? []).map((s) => ({
						amount: s.visitors,
						display: fmtC(s.visitors),
						filter: { dimension: "source", value: s.source },
						glyph,
						key: s.source,
						label: s.source,
					}));
		return sortItems(raw, dir);
	}, [dash, tab, dir]);

	return (
		<Panel
			title={t("traffic.sources.title")}
			hint={
				<SortHint
					dir={dir}
					label={t("unit.visitors")}
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
		>
			<div className="mb-2">
				<PanelTabs
					value={tab}
					onChange={setTab}
					label={t("traffic.sources.title")}
					tabs={[
						{ key: "referrer", label: t("traffic.sources.referrer") },
						{ key: "channel", label: t("rev.tab.channel") },
					]}
				/>
			</div>
			<PanelState
				loading={state.loading}
				error={state.error}
				onRetry={state.onRetry}
				retrying={state.retrying}
				hasData={items.length > 0}
				emptyText={t("traffic.sources.empty")}
				emptyAction={widen}
				boxClass={RANK_BOX}
			>
				<RankRows items={items} handle={handle} />
			</PanelState>
		</Panel>
	);
};

/* ------------------------------ traffic: pages ------------------------------ */

type PageTab = "pages" | "entry" | "exit";

export const PagesPanel = ({
	state,
	handle,
	widen,
}: {
	state: DashState;
	handle: FilterHandle;
	widen?: WidenAction;
}) => {
	const t = useT();
	const { dash } = state;
	const [tab, setTab] = useState<PageTab>("pages");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const items = useMemo((): RankItem[] => {
		const glyph = <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />;
		const toItem = (path: string, amount: number, dimension = "path"): RankItem => ({
			amount,
			display: fmtC(amount),
			filter: { dimension, value: path },
			glyph,
			key: path,
			label: path,
		});
		let raw: RankItem[] = (dash?.topPages ?? []).map((p) => toItem(p.path, p.pageviews));
		if (tab === "entry") {
			raw = (dash?.entryPagesRevenue ?? []).map((p) => toItem(p.path, p.sessions, "entry_path"));
		} else if (tab === "exit") {
			raw = (dash?.exitPages ?? []).map((p) => toItem(p.path, p.exits));
		}
		return sortItems(raw, dir);
	}, [dash, tab, dir]);
	const unit: Record<PageTab, MessageKey> = {
		entry: "unit.sessions",
		exit: "unit.exits",
		pages: "unit.views",
	};

	return (
		<Panel
			title={t("traffic.pages.title")}
			hint={
				<SortHint
					dir={dir}
					label={t(unit[tab])}
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
		>
			<div className="mb-2">
				<PanelTabs
					value={tab}
					onChange={setTab}
					label={t("traffic.pages.title")}
					tabs={[
						{ key: "pages", label: t("traffic.pages.pages") },
						{ key: "entry", label: t("traffic.pages.entry") },
						{ key: "exit", label: t("traffic.pages.exit") },
					]}
				/>
			</div>
			<PanelState
				loading={state.loading}
				error={state.error}
				onRetry={state.onRetry}
				retrying={state.retrying}
				hasData={items.length > 0}
				emptyText={t("traffic.pages.empty")}
				emptyAction={widen}
				boxClass={RANK_BOX}
			>
				<RankRows items={items} handle={handle} />
			</PanelState>
		</Panel>
	);
};

/* ----------------------------- traffic: location ---------------------------- */

type LocationTab = "country" | "region" | "city" | "globe";

export const LocationPanel = ({
	siteId,
	rangeKey,
	filterStr,
	handle,
	widen,
}: {
	siteId: string;
	rangeKey: RangeKey;
	filterStr: string;
	handle: FilterHandle;
	widen?: WidenAction;
}) => {
	const t = useT();
	const locale = useLocale();
	const [tab, setTab] = useState<LocationTab>("country");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const geoQ = useQuery({
		enabled: Boolean(siteId),
		meta: { silent: true },
		queryFn: () => fetchGeo(siteId, rangeKey, filterStr),
		queryKey: ["legacy", "geo", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const geoRows = geoQ.data ?? NO_ROWS;

	const items = useMemo((): RankItem[] => {
		const dimension = tab === "region" || tab === "city" ? tab : "country";
		const keyOf = (r: GeoRow): string | null => r[dimension];
		const raw = aggregateGeo(geoRows, keyOf).map((row): RankItem => ({
			amount: row.value,
			display: fmtC(row.value),
			filter: { dimension, value: row.label },
			glyph: dimension === "country" ? <Flag code={row.label} /> : undefined,
			key: row.label,
			label: dimension === "country" ? countryName(row.label, locale) : row.label,
		}));
		return sortItems(raw, dir);
	}, [geoRows, tab, dir, locale]);

	const globeMarkers = useMemo(
		() =>
			geoRows
				.filter((r) => r.city && CITY_COORDS[r.city])
				.slice(0, 8)
				.map((r) => ({
					city: r.city as string,
					location: CITY_COORDS[r.city as string],
				})),
		[geoRows],
	);

	const refetch = () => void geoQ.refetch();
	let body: React.ReactNode;
	if (tab === "globe") {
		body = (
			<PanelState
				loading={geoQ.isLoading}
				error={geoQ.error}
				onRetry={refetch}
				retrying={geoQ.isFetching}
				hasData={globeMarkers.length > 0}
				emptyText={t("traffic.geo.emptyGlobe")}
				skeleton={
					<div className="bg-muted/40 h-72 animate-pulse rounded-lg" role="status">
						<span className="sr-only">{t("dash.loadingGlobe")}</span>
					</div>
				}
			>
				<GlobePanel markers={globeMarkers} />
			</PanelState>
		);
	} else {
		body = (
			<PanelState
				loading={geoQ.isLoading}
				error={geoQ.error}
				onRetry={refetch}
				retrying={geoQ.isFetching}
				hasData={items.length > 0}
				emptyText={t("traffic.geo.empty")}
				emptyAction={widen}
				boxClass={RANK_BOX}
			>
				<RankRows items={items} handle={handle} />
			</PanelState>
		);
	}

	return (
		<Panel
			title={t("traffic.geo.title")}
			hint={
				tab === "globe" ? undefined : (
					<SortHint
						dir={dir}
						label={t("unit.visitors")}
						onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
					/>
				)
			}
		>
			<div className="mb-2">
				<PanelTabs
					value={tab}
					onChange={setTab}
					label={t("traffic.geo.title")}
					tabs={[
						{ key: "country", label: t("traffic.geo.country") },
						{ key: "region", label: t("traffic.geo.region") },
						{ key: "city", label: t("traffic.geo.city") },
						{ key: "globe", label: t("traffic.geo.globe") },
					]}
				/>
			</div>
			{body}
		</Panel>
	);
};

/* ----------------------------- traffic: platform ---------------------------- */

type PlatformTab = "browser" | "os" | "device";

const PLATFORM_EMPTY = {
	browser: "dash.platform.browser",
	device: "dash.platform.device",
	os: "dash.platform.os",
} as const satisfies Record<PlatformTab, MessageKey>;

const PLATFORM_DIMENSION = {
	browser: "browser",
	device: "device_type",
	os: "os",
} as const satisfies Record<PlatformTab, string>;

export const PlatformPanel = ({
	state,
	handle,
	widen,
}: {
	state: DashState;
	handle: FilterHandle;
	widen?: WidenAction;
}) => {
	const t = useT();
	const { dash } = state;
	const [tab, setTab] = useState<PlatformTab>("device");
	const [dir, setDir] = useState<"desc" | "asc">("desc");
	const items = useMemo((): RankItem[] => {
		let src = dash?.devices;
		if (tab === "browser") {
			src = dash?.browsers;
		} else if (tab === "os") {
			src = dash?.os;
		}
		const raw = (src ?? []).map((d): RankItem => ({
			amount: d.visitors,
			display: fmtC(d.visitors),
			filter: { dimension: PLATFORM_DIMENSION[tab], value: d.device },
			glyph: <PlatformGlyph row={tab === "device" ? deviceGlyph(d.device) : NEUTRAL_GLYPH} />,
			key: d.device,
			label: d.device,
		}));
		return sortItems(raw, dir);
	}, [dash, tab, dir]);

	return (
		<Panel
			title={t("traffic.platform.title")}
			hint={
				<SortHint
					dir={dir}
					label={t("unit.visitors")}
					onToggle={() => setDir(dir === "desc" ? "asc" : "desc")}
				/>
			}
		>
			<div className="mb-2">
				<PanelTabs
					value={tab}
					onChange={setTab}
					label={t("traffic.platform.title")}
					tabs={[
						{ key: "device", label: t("traffic.platform.device") },
						{ key: "browser", label: t("traffic.platform.browser") },
						{ key: "os", label: t("traffic.platform.os") },
					]}
				/>
			</div>
			<PanelState
				loading={state.loading}
				error={state.error}
				onRetry={state.onRetry}
				retrying={state.retrying}
				hasData={items.length > 0}
				emptyText={t(PLATFORM_EMPTY[tab])}
				emptyAction={widen}
				boxClass={RANK_BOX}
			>
				<RankRows items={items} handle={handle} />
			</PanelState>
		</Panel>
	);
};

export { EmptyBlock, salesNote };

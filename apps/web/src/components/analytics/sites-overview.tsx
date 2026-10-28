import { Button, buttonVariants } from "@revklik/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Code2, CreditCard, Globe, Loader2, Plus } from "lucide-react";
import { useId, useState } from "react";

import { LocaleToggle } from "@/components/locale-toggle";
import { openBilling } from "@/lib/billing-nav";
import { isSelfHosted } from "@/lib/instance-config";
import { useT } from "@/lib/i18n";
import { fetchSites, isSubscriptionInactive } from "@/lib/legacy/api";
import type { SiteWithStats } from "@/lib/legacy/api";

import { AccountNotices } from "./account-notices";
import { fmt, money, RANGES } from "./data";
import type { RangeKey } from "./data";
import { siteHasEvents, SnippetModal } from "./snippet-modal";
import type { SnippetSite } from "./snippet-modal";
import { SitesView } from "./sites-view";
import { UpgradeLock } from "./upgrade-lock";

/* -------------------------------- sparkline -------------------------------- */

const SPARK_W = 240;
const SPARK_H = 48;

/**
 * Daily pageviews as a line over a faint area, so the shape reads at a
 * glance without axes. The fill is the brand traffic orange at low alpha.
 */
const Spark = ({ values }: { values: number[] }) => {
	const gradientId = useId();
	if (values.length < 2) {
		return <div className="bg-muted/50 h-12 rounded-md" aria-hidden />;
	}
	const max = Math.max(...values, 1);
	const points = values.map(
		(v, i) =>
			`${((i / (values.length - 1)) * SPARK_W).toFixed(1)},${(SPARK_H - (v / max) * (SPARK_H - 4) - 2).toFixed(1)}`,
	);
	const area = `M0,${SPARK_H} L${points.join(" L")} L${SPARK_W},${SPARK_H} Z`;
	return (
		<svg
			viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
			className="text-(--chart) h-12 w-full"
			preserveAspectRatio="none"
			aria-hidden
		>
			<defs>
				<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
					<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
				</linearGradient>
			</defs>
			<path d={area} fill={`url(#${gradientId})`} />
			<polyline
				points={points.join(" ")}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
};

/* --------------------------------- site card ------------------------------- */

/**
 * The domain link stretches over the whole card (after:inset-0), so the
 * install button can sit on top without nesting a button inside a link.
 * Visitors lead (the number owners check first), pageviews and revenue
 * follow; a site with no events swaps the numbers for the install step.
 */
const SiteCard = ({
	site,
	onInstall,
}: {
	site: SiteWithStats;
	onInstall: (site: SiteWithStats) => void;
}) => {
	const t = useT();
	const installed = siteHasEvents(site);
	const label = site.domain || site.name;
	const showName = Boolean(site.name && site.domain && site.name !== site.domain);
	return (
		<div className="bg-card ring-foreground/10 hover:ring-foreground/25 relative flex flex-col rounded-2xl p-4 ring-1 transition-[box-shadow] duration-150">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<Link
						to="/analytics/$siteId"
						params={{ siteId: site.id }}
						className="focus-visible:outline-ring block truncate rounded-sm text-[15px] font-semibold tracking-tight outline-offset-2 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-2"
					>
						{label}
					</Link>
					{showName ? <p className="text-muted-foreground truncate text-xs">{site.name}</p> : null}
				</div>
				{installed ? null : (
					<span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 dark:text-amber-200 ring-amber-500/30">
						{t("install.notInstalled")}
					</span>
				)}
			</div>

			{installed ? (
				<>
					{/* One line box (leading-8) for every value keeps the labels on one row. */}
					<dl className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-2">
						<div>
							<dt className="text-muted-foreground text-xs">{t("overview.visitors")}</dt>
							<dd className="text-2xl leading-8 font-semibold tracking-tight tabular-nums">
								{fmt(site.visitors)}
							</dd>
						</div>
						<div>
							<dt className="text-muted-foreground text-xs">{t("overview.pageviews")}</dt>
							<dd className="text-sm leading-8 font-medium tabular-nums">{fmt(site.pageviews)}</dd>
						</div>
						{site.revenue > 0 ? (
							<div>
								<dt className="text-muted-foreground text-xs">{t("overview.revenue")}</dt>
								<dd className="text-(--money) text-sm leading-8 font-medium tabular-nums">
									{money(site.revenue, site.currency)}
								</dd>
							</div>
						) : null}
					</dl>
					<div className="mt-4">
						<Spark values={site.sparkline} />
						<p className="text-muted-foreground mt-1 text-[11px]">{t("overview.spark")}</p>
					</div>
				</>
			) : (
				<div className="mt-4 flex flex-1 flex-col items-start justify-between gap-4">
					<p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
						{t("overview.notInstalledDesc", { domain: label })}
					</p>
					<Button className="relative z-10 h-9 px-3" onClick={() => onInstall(site)}>
						<Code2 className="size-3.5" aria-hidden />
						{t("install.cta")}
					</Button>
				</div>
			)}
		</div>
	);
};

/* ------------------------------- range pills ------------------------------- */

const RangePills = ({
	rangeKey,
	onRange,
}: {
	rangeKey: RangeKey;
	onRange: (r: RangeKey) => void;
}) => {
	const t = useT();
	return (
		<div
			role="group"
			aria-label={t("overview.rangeLabel")}
			className="bg-muted/70 flex rounded-full p-0.5"
		>
			{RANGES.map((r) => (
				<button
					key={r.key}
					type="button"
					aria-pressed={rangeKey === r.key}
					onClick={() => onRange(r.key)}
					className={`focus-visible:outline-ring pointer-coarse:min-h-10 min-h-8 rounded-full px-2.5 text-xs font-medium tabular-nums outline-offset-2 transition-colors duration-150 focus-visible:outline-2 ${
						rangeKey === r.key
							? "bg-card text-foreground ring-foreground/10 ring-1"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{r.label}
				</button>
			))}
		</div>
	);
};

/* ---------------------------------- page ----------------------------------- */

/** Fewer than three sites get wider cards instead of an empty third column. */
const gridCols = (count: number): string =>
	count <= 2 ? "md:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";

const SitesOverviewPage = () => {
	const t = useT();
	const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
	const [manageOpen, setManageOpen] = useState(false);
	const [installFor, setInstallFor] = useState<SnippetSite | null>(null);

	const sitesQ = useQuery({
		queryFn: () => fetchSites(rangeKey),
		queryKey: ["legacy", "sites", rangeKey],
		retry: false,
		staleTime: 60_000,
	});
	const sites = sitesQ.data ?? [];

	if (isSubscriptionInactive(sitesQ.error)) {
		return (
			<div className="bg-background text-foreground min-h-svh pt-3">
				<UpgradeLock error={sitesQ.error} onUpgrade={() => openBilling()} />
			</div>
		);
	}

	return (
		<div className="bg-background text-foreground min-h-svh">
			<main className="mx-auto max-w-7xl px-3 pt-4 pb-8 md:px-4 md:pt-6">
				<AccountNotices onUpgrade={() => openBilling()} />
				{/* Phones: title + language toggle on one line, actions below.
				    sm and up: title, actions, toggle in one row. */}
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<div className="min-w-0 flex-1">
						<h1 className="text-lg font-semibold tracking-tight">{t("sites.title")}</h1>
						<p className="text-muted-foreground text-xs">{t("overview.subtitle")}</p>
					</div>
					<LocaleToggle className="sm:order-last" />
					<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
						<RangePills rangeKey={rangeKey} onRange={setRangeKey} />
						{isSelfHosted() ? null : (
							<Link
								to="/analytics/billing"
								className={buttonVariants({
									className: "pointer-coarse:h-10 h-8",
									variant: "outline",
								})}
							>
								<CreditCard aria-hidden /> {t("billing.title")}
							</Link>
						)}
						<Button className="pointer-coarse:h-10 h-8" onClick={() => setManageOpen(true)}>
							<Plus aria-hidden /> {t("sites.addBtn")}
						</Button>
					</div>
				</div>

				{sitesQ.error ? (
					<p className="rounded-xl bg-(--down)/10 px-3 py-2 text-xs text-(--down)" role="alert">
						{t("sites.loadError")}
					</p>
				) : sitesQ.isLoading ? (
					<div
						className="text-muted-foreground flex items-center justify-center gap-2 py-20 text-xs"
						role="status"
					>
						<Loader2 className="size-4 animate-spin" aria-hidden />
						{t("sites.loading")}
					</div>
				) : sites.length === 0 ? (
					<div className="bg-card ring-foreground/10 flex flex-col items-center rounded-2xl px-6 py-12 text-center ring-1">
						<span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl">
							<Globe className="size-5" aria-hidden />
						</span>
						<p className="mt-3 text-sm font-semibold">{t("overview.emptyTitle")}</p>
						<p className="text-muted-foreground mt-1 max-w-sm text-xs leading-relaxed">
							{t("overview.emptyDesc")}
						</p>
						<Button className="mt-5 h-10 px-4" onClick={() => setManageOpen(true)}>
							<Plus aria-hidden /> {t("overview.emptyCta")}
						</Button>
					</div>
				) : (
					<div className={`grid gap-2.5 ${gridCols(sites.length)}`}>
						{sites.map((s) => (
							<SiteCard
								key={s.id}
								site={s}
								onInstall={(site) =>
									setInstallFor({ domain: site.domain, hasEvents: false, id: site.id })
								}
							/>
						))}
					</div>
				)}
			</main>
			<SitesView open={manageOpen} onClose={() => setManageOpen(false)} />
			{installFor ? <SnippetModal site={installFor} onClose={() => setInstallFor(null)} /> : null}
		</div>
	);
};

export default SitesOverviewPage;

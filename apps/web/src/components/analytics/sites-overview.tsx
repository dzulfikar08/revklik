import { Button } from "@revklik/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { fetchSites } from "@/lib/legacy/api";
import type { SiteWithStats } from "@/lib/legacy/api";

import { fmt, money, RANGES } from "./data";
import type { RangeKey } from "./data";
import { SitesView } from "./sites-view";

/* -------------------------------- sparkline -------------------------------- */

const Spark = ({ values }: { values: number[] }) => {
	if (values.length < 2) {
		return <div className="bg-muted/60 h-8 rounded" aria-hidden />;
	}
	const max = Math.max(...values, 1);
	const w = 120;
	const h = 32;
	const pts = values
		.map(
			(v, i) =>
				`${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`,
		)
		.join(" ");
	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="text-(--chart) h-8 w-full"
			preserveAspectRatio="none"
			aria-hidden
		>
			<polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
		</svg>
	);
};

/* --------------------------------- site card ------------------------------- */

const SiteCard = ({ site }: { site: SiteWithStats }) => (
	<Link
		to="/analytics/$siteId"
		params={{ siteId: site.id }}
		className="bg-card ring-foreground/10 hover:bg-accent/40 block rounded-2xl p-4 ring-1 transition-colors outline-offset-2 focus-visible:outline-2"
	>
		<p className="truncate font-medium">{site.domain || site.name}</p>
		<p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
			{fmt(site.visitors)} visitors · {fmt(site.pageviews)} pageviews
			{site.revenue > 0 ? ` · ${money(site.revenue)}` : ""}
		</p>
		<div className="mt-3">
			<Spark values={site.sparkline} />
		</div>
	</Link>
);

/* ------------------------------- range pills ------------------------------- */

const RangePills = ({
	rangeKey,
	onRange,
}: {
	rangeKey: RangeKey;
	onRange: (r: RangeKey) => void;
}) => (
	<div className="bg-muted/70 flex rounded-full p-1">
		{RANGES.map((r) => (
			<button
				key={r.key}
				type="button"
				aria-pressed={rangeKey === r.key}
				onClick={() => onRange(r.key)}
				className={`focus-visible:outline-ring rounded-full px-2.5 py-1 text-[13px] font-medium outline-offset-2 focus-visible:outline-2 ${
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

/* ---------------------------------- page ----------------------------------- */

const SitesOverviewPage = () => {
	const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
	const [manageOpen, setManageOpen] = useState(false);

	const sitesQ = useQuery({
		queryFn: () => fetchSites(rangeKey),
		queryKey: ["legacy", "sites", rangeKey],
		retry: false,
		staleTime: 60_000,
	});
	const sites = sitesQ.data ?? [];

	return (
		<div className="bg-background text-foreground min-h-svh">
			<main className="mx-auto max-w-7xl px-3 pt-6 pb-6 md:px-4">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h1 className="text-lg font-semibold">Sites</h1>
						<p className="text-muted-foreground text-xs">Glance of every registered site.</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<RangePills rangeKey={rangeKey} onRange={setRangeKey} />
						<Button size="sm" onClick={() => setManageOpen(true)}>
							<Plus /> Add site
						</Button>
					</div>
				</div>

				{sitesQ.error ? (
					<p className="rounded-xl bg-(--down)/10 px-3 py-2 text-xs text-(--down)" role="alert">
						{sitesQ.error instanceof Error ? sitesQ.error.message : "Couldn't load sites."}
					</p>
				) : sitesQ.isLoading ? (
					<div className="text-muted-foreground flex items-center justify-center py-20">
						<Loader2 className="size-5 animate-spin" aria-label="Loading" />
					</div>
				) : sites.length === 0 ? (
					<div className="bg-card ring-foreground/10 rounded-2xl p-10 text-center ring-1">
						<p className="font-medium">No sites yet</p>
						<p className="text-muted-foreground mt-1 text-xs">
							Add your first site to start collecting analytics.
						</p>
						<Button className="mt-4" onClick={() => setManageOpen(true)}>
							<Plus /> Add your first site
						</Button>
					</div>
				) : (
					<div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
						{sites.map((s) => (
							<SiteCard key={s.id} site={s} />
						))}
					</div>
				)}
			</main>
			<SitesView open={manageOpen} onClose={() => setManageOpen(false)} />
		</div>
	);
};

export default SitesOverviewPage;

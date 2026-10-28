/**
 * Portfolio: revenue from every site and payment rail in one currency, gross
 * versus net of fees, plus the per-rail fee rules that decide the net.
 * Backed by GET /portfolio/revenue and GET/PUT /fee-rules.
 */
import { BrandMark } from "@revklik/ui/components/brand-mark";
import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { LocaleToggle } from "@/components/locale-toggle";
import { useT } from "@/lib/i18n";
import { LegacyApiError } from "@/lib/legacy/api";
import { fetchFeeRules, fetchPortfolio, saveFeeRules } from "@/lib/legacy/portfolio";
import type { FeeRule, FeeRuleInput, PortfolioRevenue } from "@/lib/legacy/portfolio";

import { fmt } from "./data";
import { Panel, StatTile } from "./ui";

const PORTFOLIO_RANGES = [
	{ days: 7, label: "7d" },
	{ days: 30, label: "30d" },
	{ days: 90, label: "90d" },
] as const;

const MS_PER_DAY = 86_400_000;
const BPS_PER_PERCENT = 100;
const CHART_W = 640;
const CHART_H = 120;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Inclusive UTC range ending today. */
const rangeFor = (days: number): { from: string; to: string } => {
	const now = Date.now();
	return { from: isoDay(now - (days - 1) * MS_PER_DAY), to: isoDay(now) };
};

/** Currency with cents: portfolio sales are often a few dollars, which whole-unit rounding would blur. */
const money = (value: number, currency: string): string => {
	const zeroDecimal = currency === "IDR" || currency === "JPY";
	try {
		return new Intl.NumberFormat(currency === "IDR" ? "id-ID" : "en-US", {
			currency,
			maximumFractionDigits: zeroDecimal ? 0 : 2,
			minimumFractionDigits: zeroDecimal ? 0 : 2,
			style: "currency",
		}).format(value);
	} catch {
		return `${currency} ${value.toFixed(2)}`;
	}
};

const errMessage = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

/* ----------------------------- daily bar chart ----------------------------- */

/** Gross as a light bar, net as the darker bar inside it, one pair per day. */
const DailyChart = ({ daily }: { daily: PortfolioRevenue["daily"] }) => {
	const max = Math.max(...daily.map((d) => d.gross), 1);
	const slot = CHART_W / Math.max(daily.length, 1);
	const barW = Math.max(slot * 0.7, 1);
	return (
		<svg
			viewBox={`0 0 ${CHART_W} ${CHART_H}`}
			className="h-32 w-full"
			preserveAspectRatio="none"
			role="img"
			aria-label={daily.map((d) => `${d.date}: ${fmt(d.gross)}`).join(", ")}
		>
			{daily.map((d, i) => {
				const x = i * slot + (slot - barW) / 2;
				const grossH = Math.max((Math.max(d.gross, 0) / max) * (CHART_H - 4), 1);
				const netH = Math.max((Math.max(d.net, 0) / max) * (CHART_H - 4), 0);
				return (
					<g key={d.date}>
						<title>{`${d.date}: ${fmt(d.gross)} / ${fmt(d.net)}`}</title>
						<rect
							x={x}
							y={CHART_H - grossH}
							width={barW}
							height={grossH}
							rx={1.5}
							className="fill-(--chart)/25"
						/>
						<rect
							x={x}
							y={CHART_H - netH}
							width={barW}
							height={netH}
							rx={1.5}
							className="fill-(--chart)"
						/>
					</g>
				);
			})}
		</svg>
	);
};

/* ------------------------------- breakdown table --------------------------- */

interface BreakdownRow {
	key: string;
	label: string;
	sub?: string;
	gross: number;
	net: number;
	sales: number;
}

const BreakdownTable = ({
	rows,
	currency,
	labelHeader,
}: {
	rows: BreakdownRow[];
	currency: string;
	labelHeader: string;
}) => {
	const t = useT();
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-xs">
				<thead>
					<tr className="text-muted-foreground text-start">
						<th scope="col" className="py-1 pe-2 text-start font-medium">
							{labelHeader}
						</th>
						<th scope="col" className="px-2 py-1 text-end font-medium">
							{t("portfolio.sales")}
						</th>
						<th scope="col" className="px-2 py-1 text-end font-medium">
							{t("portfolio.gross")}
						</th>
						<th scope="col" className="py-1 ps-2 text-end font-medium">
							{t("portfolio.net")}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.key} className="border-border/60 border-t">
							<td className="max-w-48 truncate py-1.5 pe-2">
								<span className="font-medium">{r.label}</span>
								{r.sub ? <span className="text-muted-foreground ms-1.5">{r.sub}</span> : null}
							</td>
							<td className="px-2 py-1.5 text-end tabular-nums">{fmt(r.sales)}</td>
							<td className="px-2 py-1.5 text-end tabular-nums">{money(r.gross, currency)}</td>
							<td className="text-(--money) py-1.5 ps-2 text-end font-medium tabular-nums">
								{money(r.net, currency)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

/* -------------------------------- fee rules -------------------------------- */

interface RuleDraft {
	rail: string;
	percent: string;
	fixed: string;
	currency: string;
	isDefault: boolean;
	dirty: boolean;
}

const toDraft = (r: FeeRule): RuleDraft => ({
	currency: r.fixed_currency ?? "USD",
	dirty: false,
	fixed: String(r.fixed_amount),
	isDefault: r.is_default,
	percent: String(r.percent_bps / BPS_PER_PERCENT),
	rail: r.rail,
});

/** Draft → request entry, or null while a number is unreadable. */
const toInput = (d: RuleDraft): FeeRuleInput | null => {
	const percent = Number(d.percent);
	const fixed = Number(d.fixed || "0");
	if (!Number.isFinite(percent) || !Number.isFinite(fixed) || percent < 0 || fixed < 0) {
		return null;
	}
	return {
		fixed_amount: fixed,
		fixed_currency: fixed > 0 ? d.currency.trim().toUpperCase() || "USD" : null,
		percent_bps: Math.round(percent * BPS_PER_PERCENT),
		rail: d.rail,
	};
};

const FeeRulesEditor = () => {
	const t = useT();
	const queryClient = useQueryClient();
	const rulesQ = useQuery({
		queryFn: fetchFeeRules,
		queryKey: ["legacy", "fee-rules"],
		staleTime: 60_000,
	});
	const [drafts, setDrafts] = useState<RuleDraft[]>([]);
	const [newRail, setNewRail] = useState("");

	useEffect(() => {
		if (rulesQ.data) setDrafts(rulesQ.data.map(toDraft));
	}, [rulesQ.data]);

	const save = useMutation({
		mutationFn: (rules: FeeRuleInput[]) => saveFeeRules(rules),
		onError: (e) => toast.error(errMessage(e, t("fees.saveError"))),
		onSuccess: (rules) => {
			queryClient.setQueryData(["legacy", "fee-rules"], rules);
			toast.success(t("fees.saved"));
		},
	});

	const update = (rail: string, patch: Partial<RuleDraft>) =>
		setDrafts((prev) => prev.map((d) => (d.rail === rail ? { ...d, ...patch, dirty: true } : d)));

	const addRail = () => {
		const rail = newRail.trim().toLowerCase();
		if (!rail || drafts.some((d) => d.rail === rail)) return;
		setDrafts((prev) => [
			...prev,
			{ currency: "USD", dirty: true, fixed: "0", isDefault: false, percent: "0", rail },
		]);
		setNewRail("");
	};

	const pending = drafts.filter((d) => d.dirty).map(toInput);
	const invalid = pending.some((p) => p === null);
	const submit = () => {
		if (invalid || pending.length === 0) return;
		save.mutate(pending.filter((p): p is FeeRuleInput => p !== null));
	};

	return (
		<Panel title={t("fees.title")} hint={t("fees.hint")}>
			{rulesQ.isLoading ? (
				<div className="text-muted-foreground flex items-center gap-2 py-6 text-xs" role="status">
					<Loader2 className="size-4 animate-spin" aria-hidden />
				</div>
			) : (
				<>
					<ul className="mt-2 space-y-1.5">
						{drafts.map((d) => (
							<li
								key={d.rail}
								className="grid grid-cols-[minmax(5rem,1fr)_5rem_5rem_4rem_auto] items-center gap-2"
							>
								<span className="truncate text-xs font-medium">
									{d.rail}
									{d.isDefault ? (
										<span className="text-muted-foreground ms-1.5 font-normal">
											{t("fees.default")}
										</span>
									) : null}
								</span>
								<Input
									aria-label={`${d.rail} ${t("fees.percent")} %`}
									inputMode="decimal"
									value={d.percent}
									onChange={(e) => update(d.rail, { percent: e.target.value })}
									className="h-8 text-xs"
								/>
								<Input
									aria-label={`${d.rail} ${t("fees.fixed")}`}
									inputMode="decimal"
									value={d.fixed}
									onChange={(e) => update(d.rail, { fixed: e.target.value })}
									className="h-8 text-xs"
								/>
								<Input
									aria-label={`${d.rail} ${t("fees.currency")}`}
									maxLength={3}
									value={d.currency}
									onChange={(e) => update(d.rail, { currency: e.target.value })}
									className="h-8 text-xs uppercase"
								/>
								{d.isDefault ? (
									<span className="size-8" aria-hidden />
								) : (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="size-8"
										aria-label={`${t("fees.reset")} ${d.rail}`}
										onClick={() => save.mutate([{ rail: d.rail, reset: true }])}
									>
										<RotateCcw aria-hidden />
									</Button>
								)}
							</li>
						))}
					</ul>
					<p className="text-muted-foreground mt-1.5 text-[11px]">
						{t("fees.percent")} (%) · {t("fees.fixed")} · {t("fees.currency")}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Input
							aria-label={t("fees.addRail")}
							placeholder={t("fees.railPlaceholder")}
							value={newRail}
							onChange={(e) => setNewRail(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") addRail();
							}}
							className="h-8 w-40 text-xs"
						/>
						<Button type="button" variant="outline" className="h-8" onClick={addRail}>
							<Plus aria-hidden /> {t("fees.addRail")}
						</Button>
						<Button
							type="button"
							className="ms-auto h-8"
							disabled={invalid || pending.length === 0 || save.isPending}
							onClick={submit}
						>
							{save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
							{t("fees.save")}
						</Button>
					</div>
				</>
			)}
		</Panel>
	);
};

/* ---------------------------------- page ----------------------------------- */

const PortfolioPage = () => {
	const t = useT();
	const [days, setDays] = useState<number>(30);
	const range = useMemo(() => rangeFor(days), [days]);

	const q = useQuery({
		queryFn: () => fetchPortfolio(range.from, range.to),
		queryKey: ["legacy", "portfolio", range.from, range.to],
		retry: false,
		staleTime: 60_000,
	});
	const data = q.data;
	const currency = data?.currency ?? "USD";
	const fees = data ? data.totals.gross - data.totals.net : undefined;

	return (
		<div className="bg-background text-foreground min-h-svh">
			<header className="border-border/60 border-b">
				<div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 md:px-4">
					<Link
						to="/analytics"
						className="hover:bg-accent focus-visible:outline-ring -m-1 flex min-h-11 items-center gap-2.5 rounded-lg p-1 pe-2 outline-offset-2 transition-colors focus-visible:outline-2"
					>
						<ArrowLeft className="text-muted-foreground size-4" aria-hidden />
						<BrandMark className="h-5 w-auto" />
						<span className="text-[15px] font-semibold tracking-tight">RevKlik</span>
						<span className="text-muted-foreground text-xs">· {t("portfolio.back")}</span>
					</Link>
					<LocaleToggle className="ms-auto" />
				</div>
			</header>
			<main className="mx-auto max-w-7xl space-y-2.5 px-3 pt-4 pb-8 md:px-4 md:pt-6">
				<div className="flex flex-wrap items-center gap-3">
					<div className="min-w-0 flex-1">
						<h1 className="text-lg font-semibold tracking-tight">{t("portfolio.title")}</h1>
						<p className="text-muted-foreground text-xs">{t("portfolio.subtitle")}</p>
					</div>
					<div role="group" className="bg-muted/70 flex rounded-full p-0.5">
						{PORTFOLIO_RANGES.map((r) => (
							<button
								key={r.days}
								type="button"
								aria-pressed={days === r.days}
								onClick={() => setDays(r.days)}
								className={`focus-visible:outline-ring pointer-coarse:min-h-10 min-h-8 rounded-full px-2.5 text-xs font-medium tabular-nums outline-offset-2 transition-colors duration-150 focus-visible:outline-2 ${
									days === r.days
										? "bg-card text-foreground ring-foreground/10 ring-1"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{r.label}
							</button>
						))}
					</div>
				</div>

				{q.error ? (
					<p className="rounded-xl bg-(--down)/10 px-3 py-2 text-xs text-(--down)" role="alert">
						{errMessage(q.error, t("portfolio.loadError"))}
					</p>
				) : (
					<>
						<div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
							<StatTile
								label={t("portfolio.gross")}
								value={data ? money(data.totals.gross, currency) : undefined}
							/>
							<StatTile
								label={t("portfolio.net")}
								value={data ? money(data.totals.net, currency) : undefined}
							/>
							<StatTile
								label={t("portfolio.fees")}
								value={fees === undefined ? undefined : money(fees, currency)}
							/>
							<StatTile
								label={t("portfolio.sales")}
								value={data ? fmt(data.totals.sales) : undefined}
								note={
									data && data.totals.refunds > 0
										? `${fmt(data.totals.refunds)} ${t("portfolio.refunds").toLowerCase()} · ${t(
												"portfolio.refundsNote",
												{ amount: money(data.totals.refund_amount, currency) },
											)}`
										: undefined
								}
							/>
						</div>

						{data && data.daily.length === 0 ? (
							<p className="bg-card ring-foreground/10 text-muted-foreground rounded-2xl px-3 py-8 text-center text-xs ring-1">
								{t("portfolio.empty")}
							</p>
						) : (
							<>
								<Panel title={t("portfolio.daily")} hint={`${range.from} → ${range.to}`}>
									{data ? <DailyChart daily={data.daily} /> : <div className="h-32" />}
								</Panel>
								<div className="grid gap-2.5 lg:grid-cols-2">
									<Panel title={t("portfolio.byProduct")}>
										<BreakdownTable
											labelHeader={t("portfolio.product")}
											currency={currency}
											rows={(data?.by_product ?? []).map((r) => ({
												gross: r.gross,
												key: `${r.site_id}:${r.product ?? ""}`,
												label: r.product ?? t("portfolio.noProduct"),
												net: r.net,
												sales: r.sales,
												sub: r.site_name,
											}))}
										/>
									</Panel>
									<Panel title={t("portfolio.byRail")}>
										<BreakdownTable
											labelHeader={t("portfolio.rail")}
											currency={currency}
											rows={(data?.by_rail ?? []).map((r) => ({
												gross: r.gross,
												key: r.rail,
												label: r.rail,
												net: r.net,
												sales: r.sales,
											}))}
										/>
									</Panel>
								</div>
								<Panel title={t("portfolio.recent")}>
									<div className="overflow-x-auto">
										<table className="w-full text-xs">
											<thead>
												<tr className="text-muted-foreground">
													<th scope="col" className="py-1 pe-2 text-start font-medium">
														{t("portfolio.date")}
													</th>
													<th scope="col" className="px-2 py-1 text-start font-medium">
														{t("portfolio.product")}
													</th>
													<th scope="col" className="px-2 py-1 text-start font-medium">
														{t("portfolio.rail")}
													</th>
													<th scope="col" className="px-2 py-1 text-end font-medium">
														{t("portfolio.gross")}
													</th>
													<th scope="col" className="py-1 ps-2 text-end font-medium">
														{t("portfolio.net")}
													</th>
												</tr>
											</thead>
											<tbody>
												{(data?.recent ?? []).map((r) => (
													<tr key={r.event_id} className="border-border/60 border-t">
														<td className="py-1.5 pe-2 whitespace-nowrap tabular-nums">
															{r.occurred_at.slice(0, 10)}
														</td>
														<td className="max-w-40 truncate px-2 py-1.5">
															{r.product ?? r.site_name}
														</td>
														<td className="px-2 py-1.5">{r.rail}</td>
														<td className="px-2 py-1.5 text-end whitespace-nowrap tabular-nums">
															{money(r.converted_gross, currency)}
															{r.currency !== currency ? (
																<span className="text-muted-foreground ms-1">
																	({r.revenue} {r.currency})
																</span>
															) : null}
														</td>
														<td
															className={`py-1.5 ps-2 text-end font-medium whitespace-nowrap tabular-nums ${
																r.converted_net < 0 ? "text-(--down)" : "text-(--money)"
															}`}
														>
															{money(r.converted_net, currency)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</Panel>
							</>
						)}
					</>
				)}

				<FeeRulesEditor />
			</main>
		</div>
	);
};

export default PortfolioPage;

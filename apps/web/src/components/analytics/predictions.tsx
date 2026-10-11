import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { avatarUrl, nameFromVisitorId } from "./identity";

import { fetchPredictions, GrowthPlanLockedError, refreshPredictions } from "@/lib/legacy/growth";
import type { RevenuePrediction } from "@/lib/legacy/growth";

import { GrowthLocked, GrowthMsg, GrowthSkeleton } from "./growth-locked";
import { useT } from "@/lib/i18n";

import { Panel } from "./ui";

const scoreTone = (p: number): string =>
	p >= 70 ? "text-(--up)" : p >= 40 ? "text-(--chart)" : "text-muted-foreground";

export const PredictionsPanel = ({
	onOpenVisitor,
	onUpgrade,
	siteId,
}: {
	onOpenVisitor?: (visitorId: string) => void;
	onUpgrade: () => void;
	siteId: string;
}) => {
	const t = useT();
	const [refreshing, setRefreshing] = useState(false);
	const q = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchPredictions(siteId),
		queryKey: ["growth", "predictions", siteId],
		retry: false,
		staleTime: 3_600_000,
	});

	const data = q.error instanceof GrowthPlanLockedError ? null : q.data;
	const top5 = (data?.predictions ?? [])
		.slice()
		.sort((a, b) => b.conversion_probability - a.conversion_probability)
		.slice(0, 5);

	const refresh = async () => {
		setRefreshing(true);
		try {
			await refreshPredictions(siteId);
			await q.refetch();
		} catch (err) {
			toast.error(
				err instanceof GrowthPlanLockedError
					? "Predictions are a Growth feature."
					: `Refresh failed: ${err instanceof Error ? err.message : "unknown error"}`,
			);
		} finally {
			setRefreshing(false);
		}
	};
	const busy = refreshing || q.isRefetching;

	return (
		<Panel
			hint={onOpenVisitor ? "click a visitor for the journey" : "top 5 visitors"}
			title="Revenue Predictions"
		>
			{q.error instanceof GrowthPlanLockedError ? (
				<GrowthLocked
					blurb="Score visitors by conversion likelihood and predicted lifetime value."
					feature="Predictive scoring"
					onUpgrade={onUpgrade}
				/>
			) : q.error ? (
				<GrowthMsg>{q.error.message}</GrowthMsg>
			) : q.isLoading ? (
				<GrowthSkeleton rows={4} />
			) : top5.length === 0 ? (
				<GrowthMsg>{t("predictions.empty")}</GrowthMsg>
			) : (
				<>
					<button
						className="text-muted-foreground hover:text-foreground mb-1.5 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[10px] transition-colors disabled:cursor-wait"
						disabled={busy}
						onClick={refresh}
						type="button"
					>
						<RefreshCw aria-hidden className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
						{busy ? "Loading…" : "Refresh"}
					</button>
					<table className="w-full text-left text-xs">
						<thead>
							<tr className="text-muted-foreground border-border/60 border-b">
								<th className="py-1.5 pr-2 font-medium">Visitor</th>
								<th className="py-1.5 pr-2 text-right font-medium">Score</th>
								<th className="py-1.5 text-right font-medium">Predicted LTV</th>
							</tr>
						</thead>
						<tbody>
							{top5.map((p: RevenuePrediction) => (
								<tr className="border-border/40 border-b last:border-b-0" key={p.visitor_id}>
									<td className="py-1.5 pr-2">
										<button
											className="focus-visible:outline-ring hover:text-(--chart) -mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors focus-visible:outline-2 disabled:cursor-default"
											disabled={!onOpenVisitor}
											onClick={() => onOpenVisitor?.(p.visitor_id)}
											title={`${p.visitor_id} — ${p.factors.join(" · ")}`}
											type="button"
										>
											<img
												alt=""
												aria-hidden
												className="size-4 shrink-0 rounded-full"
												src={avatarUrl(nameFromVisitorId(p.visitor_id))}
											/>
											<span className="truncate">{nameFromVisitorId(p.visitor_id)}</span>
										</button>
									</td>
									<td
										className={`py-1.5 pr-2 text-right font-mono font-semibold tabular-nums ${scoreTone(
											p.conversion_probability,
										)}`}
									>
										{p.conversion_probability}%
									</td>
									<td className="py-1.5 text-right font-mono tabular-nums">
										${p.predicted_revenue.toFixed(2)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{data?.model_version ? (
						<p className="text-muted-foreground mt-1.5 font-mono text-[10px]">
							Model: {data.model_version}
							{data.generated_at ? ` · ${new Date(data.generated_at).toLocaleTimeString()}` : ""}
						</p>
					) : null}
				</>
			)}
		</Panel>
	);
};

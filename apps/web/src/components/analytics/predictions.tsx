import { useQuery } from "@tanstack/react-query";
import { RefreshCw, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  fetchPredictions,
  GrowthPlanLockedError,
  refreshPredictions,
} from "@/lib/legacy/growth";
import type { RevenuePrediction } from "@/lib/legacy/growth";

import { GrowthLocked, GrowthMsg, GrowthSkeleton } from "./growth-locked";
import { Panel } from "./ui";

const scoreTone = (p: number): string =>
  p >= 70 ? "text-(--up)" : p >= 40 ? "text-(--chart)" : "text-muted-foreground";

export const PredictionsPanel = ({
  onUpgrade,
  siteId,
}: {
  onUpgrade: () => void;
  siteId: string;
}) => {
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
          : `Refresh failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
      setRefreshing(false);
    }
  };
  const busy = refreshing || q.isRefetching;

  return (
    <Panel title="Revenue Predictions" hint="top 5 visitors">
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
        <GrowthMsg>No visitor data yet</GrowthMsg>
      ) : (
        <>
          <button
            className="text-muted-foreground hover:text-foreground mb-1.5 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[10px] transition-colors disabled:cursor-wait"
            disabled={busy}
            onClick={refresh}
            type="button"
          >
            <RefreshCw
              aria-hidden
              className={`h-3 w-3 ${busy ? "animate-spin" : ""}`}
            />
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
                <tr
                  className="border-border/40 border-b last:border-b-0"
                  key={p.visitor_id}
                >
                  <td className="max-w-28 truncate py-1.5 pr-2 font-mono">
                    <span
                      className="text-muted-foreground mr-1 inline-flex align-[-2px]"
                      title={p.factors.join(" · ")}
                    >
                      <TrendingUp aria-hidden className="h-3 w-3" />
                    </span>
                    {p.visitor_id.length > 12
                      ? `${p.visitor_id.slice(0, 12)}…`
                      : p.visitor_id}
                  </td>
                  <td
                    className={`py-1.5 pr-2 text-right font-mono font-semibold tabular-nums ${scoreTone(
                      p.conversion_probability
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
              {data.generated_at
                ? ` · ${new Date(data.generated_at).toLocaleTimeString()}`
                : ""}
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
};

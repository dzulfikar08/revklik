/**
 * Email reports — Settings section: schedule a recurring summary email,
 * toggle it on/off, inspect last-sent, delete.
 * Data: GET/POST/PUT/DELETE /email-reports (lib/legacy/analytics-settings.ts).
 * Old fields kept 1:1: frequency (daily|weekly|monthly), enabled, last_sent.
 */
import { Button } from "@revklik-new/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revklik-new/ui/components/select";
import { CalendarClock, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createEmailReport,
  deleteEmailReport,
  fetchEmailReports,
  updateEmailReport,
} from "@/lib/legacy/analytics-settings";
import { LegacyApiError } from "@/lib/legacy/api";

import { Panel } from "./ui";

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

const errMsg = (e: unknown, fallback: string): string =>
  e instanceof LegacyApiError ? e.message : fallback;

const sentLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "never";

export const EmailReportsSection = ({ siteId }: { siteId: string }) => {
  const qc = useQueryClient();
  const [frequency, setFrequency] = useState("weekly");

  const { data: reports = [], isLoading } = useQuery({
    enabled: Boolean(siteId),
    queryFn: () => fetchEmailReports(siteId),
    queryKey: ["legacy", "email-reports", siteId],
    staleTime: 30_000,
  });

  const invalidate = { queryKey: ["legacy", "email-reports", siteId] };

  const createMut = useMutation({
    mutationFn: () => createEmailReport(siteId, frequency),
    onSuccess: () => {
      qc.invalidateQueries(invalidate);
      toast.success(`${frequency} report scheduled`);
    },
    onError: (e) => toast.error(errMsg(e, "Failed to create report")),
  });

  const toggleMut = useMutation({
    mutationFn: ({
      id,
      enabled,
    }: {
      id: string;
      enabled: boolean;
    }) => updateEmailReport(id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries(invalidate);
      toast.success("Report updated");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to update report")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEmailReport(id),
    onSuccess: () => {
      qc.invalidateQueries(invalidate);
      toast.success("Report deleted");
    },
    onError: (e) => toast.error(errMsg(e, "Failed to delete report")),
  });

  return (
    <Panel
      title="Email reports"
      hint="recurring summary to your account email"
    >
      {!siteId ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Connect a site to schedule reports.
        </p>
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <CalendarClock className="size-3.5" aria-hidden />
              Schedule
            </span>
            <Select value={frequency} onValueChange={(v) => setFrequency(String(v))}>
              <SelectTrigger
                aria-label="Report frequency"
                className="h-8 w-32 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              Create report
            </Button>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground py-3 text-center text-xs">Loading…</p>
          ) : reports.length === 0 ? (
            <p className="text-muted-foreground py-3 text-center text-xs">
              No email reports configured.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="bg-muted/40 hover:bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2"
                >
                  <span className="w-20 font-mono text-xs capitalize">{r.frequency}</span>
                  <button
                    type="button"
                    aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.frequency} report`}
                    disabled={toggleMut.isPending}
                    onClick={() => toggleMut.mutate({ id: r.id, enabled: !r.enabled })}
                    className={`focus-visible:outline-ring rounded-full px-2 py-0.5 text-[11px] font-medium outline-offset-2 focus-visible:outline-2 ${
                      r.enabled
                        ? "bg-(--up)/10 text-(--up)"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <span className="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">
                    last sent {sentLabel(r.last_sent)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete ${r.frequency} report`}
                    disabled={deleteMut.isPending}
                    onClick={() => deleteMut.mutate(r.id)}
                    className="text-muted-foreground hover:text-(--down) focus-visible:outline-ring rounded p-1 outline-offset-2 focus-visible:outline-2 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
};

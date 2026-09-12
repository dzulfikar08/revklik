/**
 * Admin view (super_admin only): member roster with subscription state,
 * registered sites, and event activity — plus an on-demand DB backup.
 */
import { Button } from "@revklik-new/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { fetchMembers, runBackup, type AdminMember } from "@/lib/legacy/admin";

import { Panel } from "./ui";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-(--up)/10 text-(--up)" },
  trialing: { label: "Trial", cls: "bg-sky-400/10 text-sky-300" },
  pending: { label: "Awaiting payment", cls: "bg-amber-400/10 text-amber-300" },
  none: { label: "Free", cls: "bg-muted text-muted-foreground" },
};

const fmtDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      })
    : "—";

const fmtWhen = (iso: string | null): string => {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days > 30) return fmtDate(iso);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
};

const StatusBadge = ({ status }: { status: string }) => {
  const meta = STATUS_LABEL[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span
      className={`font-mono rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
};

const MembersPanel = () => {
  const membersQ = useQuery({
    queryFn: fetchMembers,
    queryKey: ["legacy", "admin-members"],
    staleTime: 30_000,
  });
  const [query, setQuery] = useState("");
  const members = membersQ.data ?? [];
  const filtered = members.filter((m) =>
    `${m.email} ${m.name} ${m.sites.map((s) => s.domain).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <Panel
      title="Members"
      hint={`${members.length} account${members.length === 1 ? "" : "s"}`}
    >
      {membersQ.isLoading ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Loading members…
        </p>
      ) : members.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          No members registered yet.
        </p>
      ) : (
        <>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by email, name or domain…"
          className="border-border/60 bg-background focus-visible:outline-ring mb-2 h-8 w-full rounded-lg border px-2.5 font-mono text-xs outline-none focus-visible:outline-2"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
                <th className="py-1 pr-3 font-medium">Member</th>
                <th className="py-1 pr-3 font-medium">Plan</th>
                <th className="py-1 pr-3 font-medium">Sites</th>
                <th className="py-1 pr-3 text-right font-medium">Events</th>
                <th className="py-1 pr-3 text-right font-medium">Last 30d</th>
                <th className="py-1 pr-3 font-medium">Last event</th>
                <th className="py-1 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Panel>
  );
};

const MemberRow = ({ member: m }: { member: AdminMember }) => (
  <tr className="border-border/60 border-t align-top">
    <td className="py-2 pr-3">
      <span className="block max-w-52 truncate font-medium">{m.email}</span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
        {m.name}
        {m.role === "super_admin" ? (
          <span className="bg-(--violet)/15 text-(--violet) rounded-full px-1.5 py-px font-mono text-[9px] font-semibold uppercase">
            admin
          </span>
        ) : null}
        · joined {fmtDate(m.created_at)}
      </span>
    </td>
    <td className="py-2 pr-3">
      <div className="flex flex-col items-start gap-1">
        <span className="font-mono text-[11px] capitalize">{m.plan}</span>
        <StatusBadge status={m.subscription_status} />
        {m.awaiting_payment ? (
          <span className="text-amber-300 text-[10px]">QRIS unpaid</span>
        ) : null}
      </div>
    </td>
    <td className="text-muted-foreground max-w-44 py-2 pr-3">
      {m.sites.length ? (
        <span className="block truncate font-mono text-[11px]" title={m.sites.map((s) => s.domain).join(", ")}>
          {m.sites.map((s) => s.domain).join(", ")}
        </span>
      ) : (
        <span className="text-[11px]">—</span>
      )}
      <span className="block text-[10px]">{m.sites.length} site{m.sites.length === 1 ? "" : "s"}</span>
    </td>
    <td className="py-2 pr-3 text-right font-mono tabular-nums">
      {m.events_total.toLocaleString()}
    </td>
    <td className="py-2 pr-3 text-right font-mono tabular-nums">
      {m.events_last_30d.toLocaleString()}
    </td>
    <td className="text-muted-foreground py-2 pr-3 font-mono text-[11px]">
      {fmtWhen(m.last_event_at)}
    </td>
    <td className="text-muted-foreground py-2 font-mono text-[11px]">
      {fmtDate(m.created_at)}
    </td>
  </tr>
);

export const AdminView = () => {
  const qc = useQueryClient();
  const backupMut = useMutation({
    mutationFn: runBackup,
    onSuccess: () => {
      toast.success("Database backup written to R2");
      qc.invalidateQueries({ queryKey: ["legacy", "admin-members"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
          <p className="text-muted-foreground text-xs">
            Members, subscriptions and platform maintenance
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => backupMut.mutate()}
          disabled={backupMut.isPending}
        >
          <DatabaseBackup className="size-3.5" aria-hidden />
          {backupMut.isPending ? "Backing up…" : "Backup now"}
        </Button>
      </div>
      <MembersPanel />
      {backupMut.error ? (
        <p className="bg-(--down)/10 text-(--down) mt-2 rounded-lg px-3 py-2 text-xs">
          {backupMut.error instanceof Error ? backupMut.error.message : "Backup failed"}
        </p>
      ) : null}
    </main>
  );
};

/**
 * Admin view (super_admin only): member roster with subscription state,
 * registered sites, and event activity — plus an on-demand DB backup.
 */
import { Button } from "@revklik/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatDate, useLocale, useT } from "@/lib/i18n";
import type { Locale, MessageKey } from "@/lib/i18n";
import { fetchMembers, runBackup, type AdminMember } from "@/lib/legacy/admin";

import { Panel } from "./ui";

const STATUS_LABEL: Record<string, { labelKey: MessageKey; cls: string }> = {
	active: { labelKey: "admin.status.active", cls: "bg-(--up)/10 text-(--up)" },
	trialing: { labelKey: "admin.status.trialing", cls: "bg-sky-400/10 text-sky-300" },
	pending: { labelKey: "admin.status.pending", cls: "bg-amber-400/10 text-amber-300" },
	none: { labelKey: "admin.status.none", cls: "bg-muted text-muted-foreground" },
};

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const fmtDate = (iso: string | null, locale: Locale): string =>
	iso ? formatDate(iso, locale) : "—";

const fmtWhen = (iso: string | null, locale: Locale, t: Translate): string => {
	if (!iso) return t("admin.never");
	const diff = Date.now() - new Date(iso).getTime();
	const days = Math.floor(diff / 86_400_000);
	if (days > 30) return fmtDate(iso, locale);
	if (days >= 1) return t("admin.daysAgo", { n: days });
	const hours = Math.floor(diff / 3_600_000);
	if (hours >= 1) return t("admin.hoursAgo", { n: hours });
	return t("admin.minutesAgo", { n: Math.max(1, Math.floor(diff / 60_000)) });
};

const StatusBadge = ({ status }: { status: string }) => {
	const t = useT();
	const meta = STATUS_LABEL[status];
	return (
		<span
			className={`font-mono rounded-full px-2 py-0.5 text-[10px] font-semibold ${
				meta?.cls ?? "bg-muted text-muted-foreground"
			}`}
		>
			{meta ? t(meta.labelKey) : status}
		</span>
	);
};

const MembersPanel = () => {
	const t = useT();
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
			.includes(query.toLowerCase()),
	);

	return (
		<Panel title={t("admin.members")} hint={t("admin.accounts", { n: members.length })}>
			{membersQ.isLoading ? (
				<p className="text-muted-foreground py-4 text-center text-xs">
					{t("admin.loadingMembers")}
				</p>
			) : members.length === 0 ? (
				<p className="text-muted-foreground py-4 text-center text-xs">{t("admin.noMembers")}</p>
			) : (
				<>
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("admin.filterPlaceholder")}
						aria-label={t("admin.filterPlaceholder")}
						className="border-border/60 bg-background focus-visible:outline-ring mb-2 h-8 w-full rounded-lg border px-2.5 font-mono text-xs outline-none focus-visible:outline-2"
					/>
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="text-muted-foreground text-[10px] tracking-wider uppercase">
									<th className="py-1 pr-3 font-medium">{t("admin.col.member")}</th>
									<th className="py-1 pr-3 font-medium">{t("admin.col.plan")}</th>
									<th className="py-1 pr-3 font-medium">{t("admin.col.sites")}</th>
									<th className="py-1 pr-3 text-right font-medium">{t("admin.col.events")}</th>
									<th className="py-1 pr-3 text-right font-medium">{t("admin.col.last30d")}</th>
									<th className="py-1 pr-3 font-medium">{t("admin.col.lastEvent")}</th>
									<th className="py-1 font-medium">{t("admin.col.joined")}</th>
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

const MemberRow = ({ member: m }: { member: AdminMember }) => {
	const t = useT();
	const locale = useLocale();
	return (
		<tr className="border-border/60 border-t align-top">
			<td className="py-2 pr-3">
				<span className="block max-w-52 truncate font-medium">{m.email}</span>
				<span className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
					{m.name}
					{m.role === "super_admin" ? (
						<span className="bg-(--violet)/15 text-(--violet) rounded-full px-1.5 py-px font-mono text-[9px] font-semibold uppercase">
							{t("admin.platformAdmin")}
						</span>
					) : null}
					· {t("admin.joined", { date: fmtDate(m.created_at, locale) })}
				</span>
			</td>
			<td className="py-2 pr-3">
				<div className="flex flex-col items-start gap-1">
					<span className="font-mono text-[11px] capitalize">{m.plan}</span>
					<StatusBadge status={m.subscription_status} />
					{m.awaiting_payment ? (
						<span className="text-amber-300 text-[10px]">{t("admin.qrisUnpaid")}</span>
					) : null}
				</div>
			</td>
			<td className="text-muted-foreground max-w-44 py-2 pr-3">
				{m.sites.length ? (
					<span
						className="block truncate font-mono text-[11px]"
						title={m.sites.map((s) => s.domain).join(", ")}
					>
						{m.sites.map((s) => s.domain).join(", ")}
					</span>
				) : (
					<span className="text-[11px]">—</span>
				)}
				<span className="block text-[10px]">{t("admin.sitesCount", { n: m.sites.length })}</span>
			</td>
			<td className="py-2 pr-3 text-right font-mono tabular-nums">
				{m.events_total.toLocaleString(locale)}
			</td>
			<td className="py-2 pr-3 text-right font-mono tabular-nums">
				{m.events_last_30d.toLocaleString(locale)}
			</td>
			<td className="text-muted-foreground py-2 pr-3 font-mono text-[11px]">
				{fmtWhen(m.last_event_at, locale, t)}
			</td>
			<td className="text-muted-foreground py-2 font-mono text-[11px]">
				{fmtDate(m.created_at, locale)}
			</td>
		</tr>
	);
};

export const AdminView = () => {
	const qc = useQueryClient();
	const t = useT();
	const backupMut = useMutation({
		mutationFn: runBackup,
		onSuccess: () => {
			toast.success(t("admin.backupDone"));
			qc.invalidateQueries({ queryKey: ["legacy", "admin-members"] });
		},
		onError: (err) => toast.error(err.message),
	});

	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h1 className="text-lg font-semibold tracking-tight">{t("admin.title")}</h1>
					<p className="text-muted-foreground text-xs">{t("admin.subtitle")}</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => backupMut.mutate()}
					disabled={backupMut.isPending}
				>
					<DatabaseBackup className="size-3.5" aria-hidden />
					{backupMut.isPending ? t("admin.backingUp") : t("admin.backupNow")}
				</Button>
			</div>
			<MembersPanel />
			{backupMut.error ? (
				<p className="bg-(--down)/10 text-(--down) mt-2 rounded-lg px-3 py-2 text-xs">
					{backupMut.error instanceof Error ? backupMut.error.message : t("admin.backupFailed")}
				</p>
			) : null}
		</main>
	);
};

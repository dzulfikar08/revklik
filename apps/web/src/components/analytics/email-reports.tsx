/**
 * Email reports — Settings section: schedule a recurring summary email,
 * toggle it on/off, inspect last-sent, delete.
 * Data: GET/POST/PUT/DELETE /email-reports (lib/legacy/analytics-settings.ts).
 * Old fields kept 1:1: frequency (daily|weekly|monthly), enabled, last_sent.
 */
import { Button } from "@revklik/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
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
import { formatDate, useLocale, useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

import { Panel } from "./ui";

const FREQUENCIES: readonly { value: string; labelKey: MessageKey }[] = [
	{ value: "daily", labelKey: "emailReports.freq.daily" },
	{ value: "weekly", labelKey: "emailReports.freq.weekly" },
	{ value: "monthly", labelKey: "emailReports.freq.monthly" },
];

const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

export const EmailReportsSection = ({ siteId }: { siteId: string }) => {
	const qc = useQueryClient();
	const t = useT();
	const locale = useLocale();
	const [frequency, setFrequency] = useState("weekly");

	const frequencyLabel = (value: string): string => {
		const match = FREQUENCIES.find((f) => f.value === value);
		return match ? t(match.labelKey) : value;
	};
	const sentLabel = (iso: string | null): string =>
		iso ? formatDate(iso, locale) : t("emailReports.never");

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
			toast.success(
				t("emailReports.scheduled", { frequency: frequencyLabel(frequency).toLowerCase() }),
			);
		},
		onError: (e) => toast.error(errMsg(e, t("emailReports.createFailed"))),
	});

	const toggleMut = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			updateEmailReport(id, { enabled }),
		onSuccess: () => {
			qc.invalidateQueries(invalidate);
			toast.success(t("emailReports.updated"));
		},
		onError: (e) => toast.error(errMsg(e, t("emailReports.updateFailed"))),
	});

	const deleteMut = useMutation({
		mutationFn: (id: string) => deleteEmailReport(id),
		onSuccess: () => {
			qc.invalidateQueries(invalidate);
			toast.success(t("emailReports.deleted"));
		},
		onError: (e) => toast.error(errMsg(e, t("emailReports.deleteFailed"))),
	});

	return (
		<Panel title={t("emailReports.title")} hint={t("emailReports.hint")}>
			{!siteId ? (
				<p className="text-muted-foreground py-4 text-center text-xs">
					{t("emailReports.connectSite")}
				</p>
			) : (
				<>
					<div className="mb-2.5 flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<CalendarClock className="size-3.5" aria-hidden />
							{t("emailReports.schedule")}
						</span>
						<Select value={frequency} onValueChange={(v) => setFrequency(String(v))}>
							<SelectTrigger
								aria-label={t("emailReports.frequencyLabel")}
								className="h-8 w-32 text-xs"
							>
								<SelectValue>
									{(value: string | null) => {
										const f = FREQUENCIES.find((x) => x.value === value);
										return f ? t(f.labelKey) : null;
									}}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{FREQUENCIES.map((f) => (
									<SelectItem key={f.value} value={f.value}>
										{t(f.labelKey)}
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
							{t("emailReports.create")}
						</Button>
					</div>

					{isLoading ? (
						<p className="text-muted-foreground py-3 text-center text-xs">
							{t("emailReports.loading")}
						</p>
					) : reports.length === 0 ? (
						<p className="text-muted-foreground py-3 text-center text-xs">
							{t("emailReports.empty")}
						</p>
					) : (
						<ul className="space-y-0.5">
							{reports.map((r) => (
								<li
									key={r.id}
									className="bg-muted/40 hover:bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2"
								>
									<span className="w-20 font-mono text-xs">{frequencyLabel(r.frequency)}</span>
									<button
										type="button"
										aria-label={t(
											r.enabled ? "emailReports.disableAria" : "emailReports.enableAria",
											{
												frequency: frequencyLabel(r.frequency).toLowerCase(),
											},
										)}
										disabled={toggleMut.isPending}
										onClick={() => toggleMut.mutate({ id: r.id, enabled: !r.enabled })}
										className={`focus-visible:outline-ring rounded-full px-2 py-0.5 text-[11px] font-medium outline-offset-2 focus-visible:outline-2 ${
											r.enabled ? "bg-(--up)/10 text-(--up)" : "bg-muted text-muted-foreground"
										}`}
									>
										{r.enabled ? t("emailReports.enabled") : t("emailReports.disabled")}
									</button>
									<span className="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">
										{t("emailReports.lastSent", { when: sentLabel(r.last_sent) })}
									</span>
									<button
										type="button"
										aria-label={t("emailReports.deleteAria", {
											frequency: frequencyLabel(r.frequency).toLowerCase(),
										})}
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

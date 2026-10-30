/**
 * Saved segments — chips that apply a segment to the dashboard filters,
 * plus a save-current-filters popover with manage/delete.
 * Data: GET/POST/DELETE /segments (see lib/legacy/analytics-settings.ts).
 */
import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Bookmark, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { createSegment, deleteSegment, fetchSegments } from "@/lib/legacy/analytics-settings";
import type { LegacySegment } from "@/lib/legacy/analytics-settings";
import { encodeFilterString, LegacyApiError } from "@/lib/legacy/api";
import { useT } from "@/lib/i18n";
import type { LegacyFilter } from "@/lib/legacy/api";

const parseSegmentFilters = (raw: string): LegacyFilter[] => {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(
			(f): f is LegacyFilter =>
				typeof f === "object" &&
				f !== null &&
				typeof (f as LegacyFilter).dimension === "string" &&
				typeof (f as LegacyFilter).operator === "string",
		);
	} catch {
		return [];
	}
};

const SegmentPopover = ({
	siteId,
	filters,
	segments,
	onDone,
}: {
	siteId: string;
	filters: LegacyFilter[];
	segments: LegacySegment[];
	onDone: () => void;
}) => {
	const qc = useQueryClient();
	const t = useT();
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const saveMut = useMutation({
		mutationFn: () => createSegment(siteId, name.trim(), filters),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "segments", siteId] });
			toast.success(t("segments.saved", { name: name.trim() }));
			setName("");
			onDone();
		},
		onError: (e) => toast.error(e instanceof LegacyApiError ? e.message : t("segments.saveFailed")),
	});
	const deleteMut = useMutation({
		mutationFn: (id: string) => deleteSegment(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "segments", siteId] });
			toast.success(t("segments.deleted"));
		},
		onError: (e) =>
			toast.error(e instanceof LegacyApiError ? e.message : t("segments.deleteFailed")),
	});

	return (
		<>
			<button
				type="button"
				aria-label={t("segments.closeMenu")}
				className="fixed inset-0 z-30 cursor-default"
				onClick={onDone}
			/>
			<div className="bg-popover ring-foreground/10 absolute top-full right-0 z-40 mt-1.5 w-72 rounded-xl p-2.5 ring-1 shadow-lg">
				<p className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
					{t("segments.saveFilters")}
				</p>
				<div className="flex gap-1.5">
					<Input
						ref={inputRef}
						value={name}
						placeholder={t("segments.namePlaceholder")}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && name.trim() && filters.length) {
								saveMut.mutate();
							}
						}}
						className="pointer-coarse:h-11 h-9 text-[13px]"
					/>
					<Button
						size="sm"
						className="pointer-coarse:h-11 h-9 text-[13px]"
						disabled={!name.trim() || filters.length === 0 || saveMut.isPending}
						onClick={() => saveMut.mutate()}
					>
						{t("segments.save")}
					</Button>
				</div>
				{filters.length === 0 ? (
					<p className="text-muted-foreground mt-1 text-[11px]">{t("segments.addFilterFirst")}</p>
				) : null}

				<p className="text-muted-foreground mt-2.5 mb-1 text-[11px] font-medium tracking-wide uppercase">
					{t("segments.manage")}
				</p>
				{segments.length === 0 ? (
					<p className="text-muted-foreground text-[11px]">{t("segments.empty")}</p>
				) : (
					<ul className="max-h-56 space-y-0.5 overflow-y-auto">
						{segments.map((s) => (
							<li
								key={s.id}
								className="hover:bg-muted/60 group flex items-center gap-1.5 rounded-lg px-1.5 py-1"
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-xs font-medium">{s.name}</span>
									<span className="text-muted-foreground block truncate font-mono text-[10px]">
										{parseSegmentFilters(s.filters)
											.map((f) => `${f.dimension} ${f.operator.replaceAll("_", " ")} ${f.value}`)
											.join(", ") || "—"}
									</span>
								</span>
								<button
									type="button"
									aria-label={t("segments.deleteAria", { name: s.name })}
									disabled={deleteMut.isPending}
									onClick={() => deleteMut.mutate(s.id)}
									className="text-muted-foreground hover:text-(--down) focus-visible:outline-ring rounded p-1 outline-offset-2 focus-visible:outline-2 disabled:opacity-40"
								>
									<Trash2 className="size-3.5" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
};

export const SegmentControls = ({
	siteId,
	filters,
	onApply,
}: {
	siteId: string;
	filters: LegacyFilter[];
	onApply: (filters: LegacyFilter[]) => void;
}) => {
	const t = useT();
	const [open, setOpen] = useState(false);
	const { data: segments = [] } = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchSegments(siteId),
		queryKey: ["legacy", "segments", siteId],
		staleTime: 30_000,
	});

	const currentStr = encodeFilterString(filters);

	return (
		<span className="relative ml-auto flex flex-wrap items-center gap-1.5">
			{segments.map((s) => {
				const parsed = parseSegmentFilters(s.filters);
				const active = parsed.length > 0 && encodeFilterString(parsed) === currentStr;
				return (
					<button
						key={s.id}
						type="button"
						aria-pressed={active}
						onClick={() => {
							if (parsed.length === 0) {
								return;
							}
							onApply(parsed);
							toast.success(t("segments.applied", { name: s.name }), {
								description: t("segments.filterCount", { n: parsed.length }),
							});
						}}
						className={`focus-visible:outline-ring inline-flex items-center gap-1 rounded-full pointer-coarse:min-h-11 min-h-8 px-3 text-[13px] font-medium outline-offset-2 focus-visible:outline-2 ${
							active
								? "bg-(--chart) text-background"
								: "bg-muted/70 hover:bg-muted text-muted-foreground"
						}`}
					>
						<Bookmark className="size-3" aria-hidden />
						{s.name}
					</button>
				);
			})}
			<button
				type="button"
				aria-label={t("segments.saveOrManage")}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={`focus-visible:outline-ring inline-flex items-center gap-1 rounded-full pointer-coarse:min-h-11 min-h-8 px-3 text-[13px] font-medium outline-offset-2 focus-visible:outline-2 ${
					open ? "bg-muted text-foreground" : "bg-muted/70 hover:bg-muted text-muted-foreground"
				}`}
			>
				<Bookmark className="size-3" aria-hidden />
				{t("segments.save")}
			</button>
			{open ? (
				<SegmentPopover
					siteId={siteId}
					filters={filters}
					segments={segments}
					onDone={() => setOpen(false)}
				/>
			) : null}
		</span>
	);
};

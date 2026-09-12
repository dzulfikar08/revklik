/**
 * Annotations — CRUD popover + markers on the traffic chart.
 * Data: GET/POST/DELETE /annotations (see lib/legacy/analytics-settings.ts).
 */
import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Flag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
	createAnnotation,
	deleteAnnotation,
	fetchAnnotations,
} from "@/lib/legacy/analytics-settings";
import type { LegacyAnnotation } from "@/lib/legacy/analytics-settings";
import { LegacyApiError } from "@/lib/legacy/api";

const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

export const AnnotationsControl = ({
	siteId,
	onAnnotations,
}: {
	siteId: string;
	onAnnotations: (annotations: LegacyAnnotation[]) => void;
}) => {
	const [open, setOpen] = useState(false);
	const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
	const [text, setText] = useState("");
	const qc = useQueryClient();

	const { data, isLoading } = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchAnnotations(siteId),
		queryKey: ["legacy", "annotations", siteId],
		staleTime: 30_000,
	});

	useEffect(() => {
		if (data) {
			onAnnotations(data);
		}
	}, [data, onAnnotations]);

	const createMut = useMutation({
		mutationFn: () => createAnnotation(siteId, date, text.trim()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "annotations", siteId] });
			toast.success("Annotation added");
			setText("");
		},
		onError: (e) => toast.error(errMsg(e, "Failed to add annotation")),
	});

	const deleteMut = useMutation({
		mutationFn: (id: string) => deleteAnnotation(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "annotations", siteId] });
			toast.success("Annotation deleted");
		},
		onError: (e) => toast.error(errMsg(e, "Failed to delete annotation")),
	});

	const annotations = data ?? [];

	return (
		<span className="relative">
			<button
				type="button"
				aria-label={`Annotations (${annotations.length})`}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={`focus-visible:outline-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium outline-offset-2 focus-visible:outline-2 ${
					open
						? "bg-muted text-foreground"
						: "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
				}`}
			>
				<Flag className="size-3.5" aria-hidden />
				{annotations.length > 0 ? annotations.length : ""}
			</button>
			{open ? (
				<>
					<button
						type="button"
						aria-label="Close annotations"
						className="fixed inset-0 z-30 cursor-default"
						onClick={() => setOpen(false)}
					/>
					<div className="bg-popover ring-foreground/10 absolute top-full right-0 z-40 mt-1.5 w-72 rounded-xl p-2.5 ring-1 shadow-lg">
						<p className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
							New annotation
						</p>
						<div className="flex gap-1.5">
							<Input
								type="date"
								value={date}
								onChange={(e) => setDate(e.target.value)}
								aria-label="Annotation date"
								className="h-8 w-[7.5rem] px-2 font-mono text-[11px]"
							/>
							<Input
								value={text}
								placeholder="e.g. Launch v2"
								onChange={(e) => setText(e.target.value)}
								aria-label="Annotation label"
								onKeyDown={(e) => {
									if (e.key === "Enter" && text.trim() && date) {
										createMut.mutate();
									}
								}}
								className="h-8 flex-1 text-xs"
							/>
							<Button
								size="sm"
								className="h-8 text-xs"
								disabled={!text.trim() || !date || createMut.isPending}
								onClick={() => createMut.mutate()}
							>
								Add
							</Button>
						</div>

						<p className="text-muted-foreground mt-2.5 mb-1 text-[11px] font-medium tracking-wide uppercase">
							On this site
						</p>
						{isLoading ? (
							<p className="text-muted-foreground text-[11px]">Loading…</p>
						) : annotations.length === 0 ? (
							<p className="text-muted-foreground text-[11px]">
								No annotations yet — they show as flags on the traffic chart.
							</p>
						) : (
							<ul className="max-h-56 space-y-0.5 overflow-y-auto">
								{annotations.map((a) => (
									<li
										key={a.id}
										className="hover:bg-muted/60 flex items-center gap-1.5 rounded-lg px-1.5 py-1"
									>
										<span className="font-mono text-[10px] whitespace-nowrap text-(--money)">
											{a.date}
										</span>
										<span className="min-w-0 flex-1 truncate text-xs">{a.text}</span>
										<button
											type="button"
											aria-label={`Delete annotation ${a.text}`}
											disabled={deleteMut.isPending}
											onClick={() => deleteMut.mutate(a.id)}
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
			) : null}
		</span>
	);
};

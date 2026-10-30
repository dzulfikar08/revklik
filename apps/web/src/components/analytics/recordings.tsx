import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Smartphone, Tablet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { agoLabel } from "./data";
import { fetchRecording, fetchRecordings, GrowthPlanLockedError } from "@/lib/legacy/growth";
import type { RecordingDetail, RecordingEventType, RecordingSummary } from "@/lib/legacy/growth";
import { GrowthLocked, GrowthMsg, GrowthSkeleton } from "./growth-locked";
import { CodeSentence, Panel } from "./ui";

/* --------------------------------- format ---------------------------------- */

/** Durations arrive in milliseconds (old recordings.tsx semantics). */
const formatDuration = (ms: number): string => {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	const s = Math.floor(ms / 1000);
	if (s < 60) {
		return `${s}s`;
	}
	const m = Math.floor(s / 60);
	return `${m}m ${s % 60}s`;
};

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

const deviceOf = (viewport: number | null, t: TFn): { Icon: LucideIcon; label: string } => {
	if (viewport === null) {
		return { Icon: Monitor, label: t("recordings.viewportUnknown") };
	}
	if (viewport <= 640) {
		return { Icon: Smartphone, label: t("recordings.deviceMobile", { px: viewport }) };
	}
	if (viewport <= 1024) {
		return { Icon: Tablet, label: t("recordings.deviceTablet", { px: viewport }) };
	}
	return { Icon: Monitor, label: t("recordings.deviceDesktop", { px: viewport }) };
};

/* ------------------------------- event chrome ------------------------------ */

const EVENT_COLORS: Record<RecordingEventType, string> = {
	interaction: "var(--chart)",
	mutation: "var(--money)",
	resize: "var(--violet)",
	scroll: "var(--up)",
};

const EventIcon = ({ type }: { type: RecordingEventType }) => {
	const common = {
		fill: "none",
		height: 12,
		stroke: EVENT_COLORS[type],
		strokeWidth: 2,
		viewBox: "0 0 24 24",
		width: 12,
	} as const;
	switch (type) {
		case "interaction":
			return (
				<svg aria-hidden {...common}>
					<circle cx="12" cy="12" r="3" />
					<path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
				</svg>
			);
		case "scroll":
			return (
				<svg aria-hidden {...common}>
					<path d="M12 5v14m-7-7l7 7 7-7" />
				</svg>
			);
		case "mutation":
			return (
				<svg aria-hidden {...common}>
					<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
				</svg>
			);
		case "resize":
			return (
				<svg aria-hidden {...common}>
					<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
				</svg>
			);
	}
};

const eventLabel = (ev: RecordingDetail["events"][number], t: TFn): string => {
	const d = ev.d as Record<string, unknown>;
	switch (ev.type) {
		case "interaction":
			return t("recordings.evClick", { x: String(d.x), y: String(d.y), tag: String(d.tg || "??") });
		case "scroll":
			return t("recordings.evScroll", { y: String(d.y) });
		case "mutation":
			return t("recordings.evMutation", {
				n: Array.isArray(d.changes) ? d.changes.length : 0,
			});
		case "resize":
			return t("recordings.evResize", { w: String(d.w), h: String(d.h) });
		default:
			return t("recordings.evUnknown");
	}
};

/* --------------------------------- replay ---------------------------------- */

/**
 * Faithful port of the old RecordingPanel replay: a 50 ms ticker advances the
 * playhead by 50ms × speed; events with t ≤ playTime become visible; the
 * progress bar seeks by click/arrow keys and shows colored event markers.
 */
const RecordingReplay = ({
	recording,
	onClose,
}: {
	recording: RecordingDetail;
	onClose: () => void;
}) => {
	const t = useT();
	const [playing, setPlaying] = useState(false);
	const [playTime, setPlayTime] = useState(0);
	const [speed, setSpeed] = useState(1);
	const totalMs =
		recording.duration ||
		(recording.events.length > 0 ? (recording.events[recording.events.length - 1]?.t ?? 0) : 0);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (playing) {
			intervalRef.current = setInterval(() => {
				setPlayTime((prev) => {
					const next = prev + 50 * speed;
					if (next >= totalMs) {
						setPlaying(false);
						return totalMs;
					}
					return next;
				});
			}, 50);
		}
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
		};
	}, [playing, speed, totalMs]);

	const reset = () => {
		setPlaying(false);
		setPlayTime(0);
	};

	const visibleEvents = useMemo(
		() => recording.events.filter((e) => e.t <= playTime),
		[recording.events, playTime],
	);

	return (
		<div className="bg-background/60 fixed inset-0 z-40" onClick={onClose}>
			<aside
				role="dialog"
				aria-modal="true"
				aria-label={t("recordings.replayLabel")}
				tabIndex={-1}
				autoFocus
				className="bg-card ring-foreground/10 fixed top-0 right-0 z-50 flex h-dvh w-full max-w-md flex-col shadow-2xl ring-1 outline-none sm:max-w-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="border-border/60 flex items-center gap-2 border-b px-4 py-3">
					<h3 className="text-sm font-semibold">{t("recordings.replayTitle")}</h3>
					<span className="text-muted-foreground flex-1 truncate font-mono text-xs">
						{recording.path}
					</span>
					<button
						aria-label={t("recordings.close")}
						className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-ring focus-visible:outline-2 outline-offset-2 rounded p-1"
						onClick={onClose}
						type="button"
					>
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>

				{/* Player controls */}
				<div className="border-border/60 flex flex-col gap-2 border-b px-4 py-3">
					<div className="flex items-center gap-2">
						<button
							aria-label={playing ? t("recordings.pause") : t("recordings.play")}
							className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring focus-visible:outline-2 outline-offset-2 flex h-8 w-8 items-center justify-center rounded-md text-sm"
							onClick={() => setPlaying(!playing)}
							type="button"
						>
							{playing ? "⏸" : "▶"}
						</button>
						<button
							aria-label={t("recordings.restart")}
							className="bg-muted text-foreground focus-visible:outline-ring focus-visible:outline-2 outline-offset-2 flex h-8 w-8 items-center justify-center rounded-md text-sm"
							onClick={reset}
							type="button"
						>
							⏮
						</button>
						<span className="text-muted-foreground min-w-24 font-mono text-xs tabular-nums">
							{formatDuration(playTime)} / {formatDuration(totalMs)}
						</span>
						<span className="flex-1" />
						<Select value={String(speed)} onValueChange={(v) => setSpeed(Number(String(v)))}>
							<SelectTrigger className="h-7 w-20 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{["0.5", "1", "2", "4"].map((s) => (
									<SelectItem key={s} value={s}>
										{s}x
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Progress bar with event markers */}
					<div
						aria-label={t("recordings.position")}
						aria-valuemax={Math.round(totalMs)}
						aria-valuemin={0}
						aria-valuenow={Math.round(playTime)}
						className="bg-muted relative h-1.5 cursor-pointer rounded-full"
						role="slider"
						tabIndex={0}
						onClick={(e) => {
							const rect = e.currentTarget.getBoundingClientRect();
							const pct = (e.clientX - rect.left) / rect.width;
							setPlayTime(Math.max(0, Math.min(totalMs, pct * totalMs)));
						}}
						onKeyDown={(e) => {
							if (e.key === "ArrowLeft") {
								e.preventDefault();
								setPlayTime((t) => Math.max(0, t - 1000));
							} else if (e.key === "ArrowRight") {
								e.preventDefault();
								setPlayTime((t) => Math.min(totalMs, t + 1000));
							}
						}}
					>
						<div
							className="bg-(--chart) h-full rounded-full transition-[width] duration-75"
							style={{
								width: totalMs > 0 ? `${(playTime / totalMs) * 100}%` : "0%",
							}}
						/>
						{recording.events
							.filter((_, i) => i % Math.max(1, Math.floor(recording.events.length / 40)) === 0)
							.map((ev, i) => (
								<div
									key={`${ev.t}-${i}`}
									className="absolute top-[-2px] h-2 w-0.5 rounded-sm opacity-70"
									style={{
										background: EVENT_COLORS[ev.type] ?? "#c084fc",
										left: totalMs > 0 ? `${(ev.t / totalMs) * 100}%` : "0%",
									}}
								/>
							))}
					</div>
					<div className="text-muted-foreground flex gap-3 text-[10px]">
						<span>{t("recordings.events", { n: recording.events.length })}</span>
						<span>
							{t("recordings.viewport", {
								w: recording.viewport_width ?? "?",
								h: recording.viewport_height ?? "?",
							})}
						</span>
					</div>
				</div>

				{/* Event timeline */}
				<div className="flex-1 overflow-y-auto px-4 py-2">
					<div className="flex flex-col gap-0.5">
						{visibleEvents.map((ev, i) => (
							<div
								key={`${ev.t}-${i}`}
								className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] ${
									i % 2 === 0 ? "bg-transparent" : "bg-muted/50"
								}`}
							>
								<span className="text-muted-foreground min-w-12 font-mono text-[9px] tabular-nums">
									{formatDuration(ev.t)}
								</span>
								<EventIcon type={ev.type} />
								<span className="flex-1 truncate">{eventLabel(ev, t)}</span>
							</div>
						))}
						{visibleEvents.length === 0 ? <GrowthMsg>{t("recordings.pressPlay")}</GrowthMsg> : null}
					</div>
				</div>
			</aside>
		</div>
	);
};

/* ---------------------------------- panel ---------------------------------- */

export const RecordingsPanel = ({
	onUpgrade,
	siteId,
	rangeKey,
	filterStr,
}: {
	onUpgrade: () => void;
	siteId: string;
	rangeKey: string;
	filterStr: string;
}) => {
	const t = useT();
	const [activeId, setActiveId] = useState<string | null>(null);

	const listQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchRecordings(siteId, rangeKey, filterStr),
		queryKey: ["growth", "recordings", siteId, rangeKey, filterStr],
		retry: false,
		staleTime: 60_000,
	});
	const detailQ = useQuery({
		enabled: Boolean(activeId),
		queryFn: () => fetchRecording(activeId ?? ""),
		queryKey: ["growth", "recording", activeId],
		retry: false,
	});

	const recordings = listQ.data ?? [];
	const listLocked = listQ.error instanceof GrowthPlanLockedError;

	// Esc closes whichever recording overlay is open (replay, loading, error).
	useEffect(() => {
		if (!activeId) {
			return;
		}
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") {
				setActiveId(null);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [activeId]);

	return (
		<Panel
			title={t("recordings.title")}
			hint={
				recordings.length
					? t("recordings.hintCount", { n: recordings.length })
					: t("recordings.hintNone")
			}
		>
			{listLocked ? (
				<GrowthLocked feature={t("recordings.feature")} onUpgrade={onUpgrade} />
			) : listQ.error ? (
				<GrowthMsg>{listQ.error.message}</GrowthMsg>
			) : listQ.isLoading ? (
				<GrowthSkeleton rows={5} />
			) : recordings.length === 0 ? (
				<GrowthMsg>
					<CodeSentence
						template={t("recordings.empty")}
						codes={{ attr: 'data-heatmap="true"', consent: "revklik_consent.recording" }}
					/>
				</GrowthMsg>
			) : (
				<table className="w-full text-left text-xs">
					<thead>
						<tr className="text-muted-foreground border-border/60 border-b">
							<th className="py-1.5 pr-2 font-medium">{t("recordings.colDevice")}</th>
							<th className="py-1.5 pr-2 font-medium">{t("recordings.colPath")}</th>
							<th className="py-1.5 pr-2 text-right font-medium">{t("recordings.colDuration")}</th>
							<th className="py-1.5 pr-2 text-right font-medium">{t("recordings.colEvents")}</th>
							<th className="py-1.5 font-medium">{t("recordings.colWhen")}</th>
						</tr>
					</thead>
					<tbody>
						{recordings.map((rec: RecordingSummary) => {
							const dev = deviceOf(rec.viewport_width, t);
							return (
								<tr
									className="hover:bg-muted/60 border-border/40 cursor-pointer border-b last:border-b-0"
									key={rec.id}
									onClick={() => setActiveId(rec.id)}
								>
									<td className="py-1.5 pr-2">
										<span title={dev.label} className="text-muted-foreground">
											<dev.Icon aria-hidden className="h-3.5 w-3.5" />
											<span className="sr-only">{dev.label}</span>
										</span>
									</td>
									<td className="max-w-32 truncate py-1.5 pr-2 font-medium">{rec.path}</td>
									<td className="text-muted-foreground py-1.5 pr-2 text-right font-mono tabular-nums">
										{formatDuration(rec.duration)}
									</td>
									<td className="text-muted-foreground py-1.5 pr-2 text-right font-mono tabular-nums">
										{rec.event_count}
									</td>
									<td className="text-muted-foreground py-1.5 text-[10px] whitespace-nowrap">
										{agoLabel(rec.started_at)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}

			{activeId ? (
				detailQ.isLoading ? (
					<div className="bg-background/60 fixed inset-0 z-40">
						<aside className="bg-card fixed top-0 right-0 z-50 flex h-dvh w-full max-w-md flex-col shadow-2xl sm:max-w-lg">
							<div className="p-4">
								<GrowthSkeleton rows={4} />
							</div>
						</aside>
					</div>
				) : detailQ.data ? (
					<RecordingReplay
						key={detailQ.data.id}
						onClose={() => setActiveId(null)}
						recording={detailQ.data}
					/>
				) : detailQ.error ? (
					<div className="bg-background/60 fixed inset-0 z-40" onClick={() => setActiveId(null)}>
						<aside className="bg-card fixed top-0 right-0 z-50 flex h-dvh w-full max-w-md flex-col shadow-2xl sm:max-w-lg">
							<div className="p-4">
								<GrowthMsg>
									{detailQ.error instanceof GrowthPlanLockedError
										? t("recordings.locked")
										: detailQ.error.message}
								</GrowthMsg>
							</div>
						</aside>
					</div>
				) : null
			) : null}
		</Panel>
	);
};

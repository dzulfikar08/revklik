// Session recordings components

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordingDetail, RecordingSummary } from "shared";
import { fetchRecording } from "@/lib/api";
import { timeAgo } from "./metric-cards";

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	return `${m}m ${rs}s`;
}

export function RecordingsTable({
	recordings,
	onSelect,
}: {
	recordings: RecordingSummary[];
	onSelect: (r: RecordingDetail) => void;
}) {
	return (
		<div
			className="data-table-card"
			style={{
				border: "none",
				background: "transparent",
				display: "flex",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 6,
				}}
			>
				<span className="data-table-title" style={{ marginBottom: 0 }}>
					Session Recordings
				</span>
				<span
					style={{
						fontSize: 10,
						color: "var(--text3)",
						fontFamily: "var(--mono)",
						marginLeft: "auto",
					}}
				>
					{recordings.length}
				</span>
			</div>
			<div style={{ flex: 1, overflowY: "auto" }}>
				{recordings.length === 0 ? (
					<div
						style={{
							padding: 20,
							color: "var(--text3)",
							fontSize: 12,
							textAlign: "center",
						}}
					>
						No recordings yet. Enable recording in your tracking script.
					</div>
				) : (
					<table className="data-table" style={{ fontSize: 11 }}>
						<thead>
							<tr>
								<th>Path</th>
								<th style={{ textAlign: "right" }}>Duration</th>
								<th style={{ textAlign: "right" }}>Events</th>
								<th>When</th>
							</tr>
						</thead>
						<tbody>
							{recordings.map((rec) => (
								<tr
									key={rec.id}
									style={{ cursor: "pointer" }}
									onClick={async () => {
										const detail = await fetchRecording(rec.id);
										if (detail) onSelect(detail as RecordingDetail);
									}}
								>
									<td
										style={{
											maxWidth: 120,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{rec.path}
									</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											color: "var(--text3)",
										}}
									>
										{formatDuration(rec.duration)}
									</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											color: "var(--text3)",
										}}
									>
										{rec.event_count}
									</td>
									<td
										style={{
											color: "var(--text3)",
											fontSize: 10,
											whiteSpace: "nowrap",
										}}
									>
										{timeAgo(rec.started_at)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

export function RecordingPanel({
	recording,
	onClose,
}: {
	recording: RecordingDetail;
	onClose: () => void;
}) {
	const [playing, setPlaying] = useState(false);
	const [playTime, setPlayTime] = useState(0);
	const [speed, setSpeed] = useState(1);
	const totalMs =
		recording.duration ||
		(recording.events.length > 0
			? recording.events[recording.events.length - 1]?.t
			: 0);
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
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [playing, speed, totalMs]);

	const reset = () => {
		setPlaying(false);
		setPlayTime(0);
	};

	const visibleEvents = useMemo(() => {
		return recording.events.filter((e) => e.t <= playTime);
	}, [recording.events, playTime]);

	const eventTypeIcon = (type: string) => {
		switch (type) {
			case "interaction":
				return (
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--accent)"
						strokeWidth="2"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
					</svg>
				);
			case "scroll":
				return (
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#6ee7b7"
						strokeWidth="2"
						aria-hidden="true"
					>
						<path d="M12 5v14m-7-7l7 7 7-7" />
					</svg>
				);
			case "mutation":
				return (
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#fbbf24"
						strokeWidth="2"
						aria-hidden="true"
					>
						<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
					</svg>
				);
			case "resize":
				return (
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#c084fc"
						strokeWidth="2"
						aria-hidden="true"
					>
						<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
					</svg>
				);
			default:
				return null;
		}
	};

	const eventLabel = (ev: RecordingDetail["events"][0]) => {
		const d = ev.d as Record<string, unknown>;
		switch (ev.type) {
			case "interaction":
				return `Click at (${d.x}, ${d.y}) on <${d.tg || "??"}>`;
			case "scroll":
				return `Scroll to y=${d.y}`;
			case "mutation":
				return `DOM change: ${Array.isArray(d.changes) ? d.changes.length : 0} mutation(s)`;
			case "resize":
				return `Resize to ${d.w}x${d.h}`;
			default:
				return "Unknown event";
		}
	};

	return (
		<div
			className="recording-panel"
			style={{
				position: "fixed",
				top: 0,
				right: 0,
				height: "100vh",
				background: "var(--bg1)",
				borderLeft: "1px solid var(--border)",
				zIndex: 100,
				display: "flex",
				flexDirection: "column",
				boxShadow: "-8px 0 32px rgba(0,0,0,.4)",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "12px 16px",
					borderBottom: "1px solid var(--border)",
				}}
			>
				<span
					style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--sans)" }}
				>
					Session Recording
				</span>
				<span style={{ flex: 1 }} />
				<span
					style={{
						fontSize: 10,
						color: "var(--text3)",
						fontFamily: "var(--mono)",
					}}
				>
					{recording.path}
				</span>
				<button
					type="button"
					onClick={onClose}
					style={{
						background: "none",
						border: "none",
						color: "var(--text3)",
						cursor: "pointer",
						fontSize: 16,
					}}
				>
					&#10005;
				</button>
			</div>

			{/* Player controls */}
			<div
				style={{
					padding: "12px 16px",
					borderBottom: "1px solid var(--border)",
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<button
						type="button"
						onClick={() => setPlaying(!playing)}
						style={{
							background: "var(--accent)",
							color: "#000",
							border: "none",
							borderRadius: 6,
							width: 32,
							height: 32,
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 14,
						}}
					>
						{playing ? "\u23F8" : "\u25B6"}
					</button>
					<button
						type="button"
						onClick={reset}
						style={{
							background: "var(--bg3)",
							color: "var(--text)",
							border: "none",
							borderRadius: 6,
							width: 32,
							height: 32,
							cursor: "pointer",
							fontSize: 14,
						}}
					>
						&#9198;
					</button>
					<span
						style={{
							fontSize: 11,
							fontFamily: "var(--mono)",
							color: "var(--text3)",
							minWidth: 90,
						}}
					>
						{formatDuration(playTime)} / {formatDuration(totalMs)}
					</span>
					<span style={{ flex: 1 }} />
					<select
						value={speed}
						onChange={(e) => setSpeed(Number(e.target.value))}
						style={{
							fontSize: 10,
							background: "var(--bg3)",
							color: "var(--text)",
							border: "1px solid var(--border2)",
							borderRadius: 4,
							padding: "2px 4px",
						}}
					>
						<option value={0.5}>0.5x</option>
						<option value={1}>1x</option>
						<option value={2}>2x</option>
						<option value={4}>4x</option>
					</select>
				</div>
				{/* Progress bar */}
				<div
					role="slider"
					tabIndex={0}
					aria-label="Playback position"
					aria-valuenow={Math.round(playTime)}
					aria-valuemin={0}
					aria-valuemax={Math.round(totalMs)}
					style={{
						position: "relative",
						height: 6,
						background: "var(--bg3)",
						borderRadius: 3,
						cursor: "pointer",
					}}
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
						style={{
							position: "absolute",
							left: 0,
							top: 0,
							height: "100%",
							width: totalMs > 0 ? `${(playTime / totalMs) * 100}%` : "0%",
							background: "var(--accent)",
							borderRadius: 3,
							transition: "width 0.05s linear",
						}}
					/>
					{/* Event markers */}
					{recording.events
						.filter(
							(_, i) =>
								i % Math.max(1, Math.floor(recording.events.length / 40)) === 0,
						)
						.map((ev) => (
							<div
								key={ev.timestamp}
								style={{
									position: "absolute",
									left: totalMs > 0 ? `${(ev.t / totalMs) * 100}%` : "0%",
									top: -1,
									width: 2,
									height: 8,
									background:
										ev.type === "interaction"
											? "var(--accent)"
											: ev.type === "scroll"
												? "#6ee7b7"
												: ev.type === "mutation"
													? "#fbbf24"
													: "#c084fc",
									borderRadius: 1,
									opacity: 0.7,
								}}
							/>
						))}
				</div>
				<div
					style={{
						display: "flex",
						gap: 12,
						fontSize: 10,
						color: "var(--text3)",
					}}
				>
					<span>{recording.events.length} events</span>
					<span>Viewport: {recording.viewport_width || "?"}px</span>
				</div>
			</div>

			{/* Event timeline */}
			<div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
				<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					{visibleEvents.map((ev, i) => (
						<div
							key={ev.timestamp}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 6px",
								borderRadius: 4,
								background: i % 2 === 0 ? "transparent" : "var(--bg2)",
								fontSize: 11,
							}}
						>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 9,
									color: "var(--text3)",
									minWidth: 45,
								}}
							>
								{formatDuration(ev.t)}
							</span>
							{eventTypeIcon(ev.type)}
							<span
								style={{
									flex: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{eventLabel(ev)}
							</span>
						</div>
					))}
					{visibleEvents.length === 0 && (
						<div
							style={{
								padding: 24,
								color: "var(--text3)",
								fontSize: 12,
								textAlign: "center",
							}}
						>
							Press play to replay events
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

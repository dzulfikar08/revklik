// Visitor profile panel

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { VisitorJourney } from "@revklik/shared";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateVisitor } from "@/lib/api";
import { t } from "@/lib/i18n";
import { avatarUrl, countryFlag, nameFromVisitorId } from "./icons";
import { JourneyTimeline } from "./journey";

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent>{text}</TooltipContent>
		</Tooltip>
	);
}

export function ProfilePanel({
	journey,
	onClose,
}: {
	journey: VisitorJourney | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [tags, setTags] = useState("");
	const [, setSaved] = useState(false);
	const [panelWidth, setPanelWidth] = useState(340);
	const dragging = useRef(false);
	const dragStartX = useRef(0);
	const dragStartW = useRef(0);

	if (!journey) return null;

	const handleEdit = () => {
		setName(journey.visitor_name ?? "");
		setEmail(journey.visitor_email ?? "");
		setTags("");
		setEditing(true);
		setSaved(false);
	};
	const handleSave = async () => {
		await updateVisitor(journey.visitor_id, {
			name: name || undefined,
			email: email || undefined,
			tags,
		});
		setEditing(false);
		setSaved(true);
		queryClient.invalidateQueries({ queryKey: ["dashboard"] });
	};

	const displayName =
		journey.visitor_name || nameFromVisitorId(journey.visitor_id);

	const onDragStart = (e: React.MouseEvent) => {
		e.preventDefault();
		dragging.current = true;
		dragStartX.current = e.clientX;
		dragStartW.current = panelWidth;
		const onMove = (ev: MouseEvent) => {
			if (!dragging.current) return;
			const delta = dragStartX.current - ev.clientX;
			setPanelWidth(Math.max(280, Math.min(600, dragStartW.current + delta)));
		};
		const onUp = () => {
			dragging.current = false;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	const emailOrId = journey.visitor_email || journey.visitor_id;

	return (
		<div className="profile-panel" style={{ width: panelWidth }}>
			{/* Resize handle */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for resizing panel; mouse-only gesture */}
			<div className="profile-resize-handle" onMouseDown={onDragStart} />
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<span
					style={{
						fontFamily: "var(--mono)",
						fontSize: 10,
						fontWeight: 600,
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						color: "var(--text3)",
					}}
				>
					{t("profile.title")}
				</span>
				<button
					type="button"
					onClick={onClose}
					style={{ fontSize: 14, color: "var(--text3)", cursor: "pointer" }}
				>
					&#10005;
				</button>
			</div>
			{editing ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Name"
					/>
					<input
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="Email"
					/>
					<input
						value={tags}
						onChange={(e) => setTags(e.target.value)}
						placeholder="Tags (comma separated)"
					/>
					<div style={{ display: "flex", gap: 8 }}>
						<button type="button" className="btn-accent" onClick={handleSave}>
							Save
						</button>
						<button
							type="button"
							className="btn-pill"
							onClick={() => setEditing(false)}
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						<img
							src={avatarUrl(displayName)}
							alt=""
							style={{
								width: 44,
								height: 44,
								borderRadius: "50%",
								background: "var(--bg3)",
							}}
						/>
						<div style={{ minWidth: 0, flex: 1 }}>
							<Tip text={displayName}>
								<p className="profile-ellipsis">{displayName}</p>
							</Tip>
							<Tip text={emailOrId}>
								<p className="profile-ellipsis-sm">
									{journey.visitor_email || journey.visitor_id.slice(0, 16)}
								</p>
							</Tip>
						</div>
					</div>
					<button
						type="button"
						onClick={handleEdit}
						style={{
							fontSize: 12,
							color: "var(--accent)",
							textAlign: "left",
							padding: 0,
							fontWeight: 600,
						}}
					>
						{t("profile.edit")}
					</button>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							gap: 8,
							fontSize: 13,
							color: "var(--text2)",
						}}
					>
						{[journey.city, journey.region, journey.country].filter(Boolean)
							.length > 0 && (
							<Tip
								text={[journey.city, journey.region, journey.country]
									.filter(Boolean)
									.join(", ")}
							>
								<span className="profile-info-cell">
									{countryFlag(journey.country)}{" "}
									{[journey.city, journey.region].filter(Boolean).join(", ")}
								</span>
							</Tip>
						)}
						{journey.device_type && (
							<span className="profile-info-cell">{journey.device_type}</span>
						)}
						{journey.browser && (
							<span className="profile-info-cell">{journey.browser}</span>
						)}
						{journey.os && (
							<span className="profile-info-cell">{journey.os}</span>
						)}
						{journey.utm_source && (
							<span className="profile-info-cell">{journey.utm_source}</span>
						)}
					</div>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr 1fr",
							gap: 8,
							paddingTop: 16,
							borderTop: "1px solid var(--border)",
							marginTop: 4,
						}}
					>
						<div style={{ textAlign: "center" }}>
							<p
								style={{
									fontFamily: "var(--mono)",
									fontSize: 20,
									fontWeight: 600,
								}}
							>
								{journey.steps.length}
							</p>
							<p style={{ fontSize: 10, color: "var(--text3)" }}>steps</p>
						</div>
						<div style={{ textAlign: "center" }}>
							<p
								style={{
									fontFamily: "var(--mono)",
									fontSize: 20,
									fontWeight: 600,
								}}
							>
								${journey.total_revenue}
							</p>
							<p style={{ fontSize: 10, color: "var(--text3)" }}>revenue</p>
						</div>
						<Tip text={journey.utm_source || "direct"}>
							<div style={{ textAlign: "center" }}>
								<p
									className="profile-ellipsis"
									style={{
										fontFamily: "var(--mono)",
										fontSize: 20,
										fontWeight: 600,
									}}
								>
									{journey.utm_source || "direct"}
								</p>
								<p style={{ fontSize: 10, color: "var(--text3)" }}>source</p>
							</div>
						</Tip>
					</div>
					<div
					style={{
						borderTop: "1px solid var(--border)",
						marginTop: 12,
						paddingTop: 12,
						flex: 1,
						minHeight: 0,
						display: "flex",
						flexDirection: "column",
					}}
					>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								fontWeight: 600,
								textTransform: "uppercase",
								letterSpacing: "0.08em",
								color: "var(--text3)",
							}}
						>
							Journey
						</span>
					<div
						style={{
							flex: 1,
							minHeight: 0,
							overflowY: "auto",
							marginTop: 8,
						}}
					>
							<JourneyTimeline journey={journey} />
						</div>
					</div>
				</>
			)}
		</div>
	);
}

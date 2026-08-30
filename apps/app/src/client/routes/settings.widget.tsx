import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import {
	fetchWidgetStatus,
	getActiveSiteId,
	regenerateWidgetToken,
	toggleWidget,
	updateWidgetConfig,
} from "@/lib/api";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/settings/widget")({ component: WidgetPage });

// East-positive UTC offset minutes, including the fractional zones (India,
// Iran, Nepal, Myanmar, ...). Sorted ascending for the dropdown.
const TZ_OFFSETS = [
	-720, -660, -600, -540, -480, -420, -360, -300, -270, -240, -210, -180, -120, -60, 0, 60, 120,
	180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 660, 720, 780, 840,
];

function fmtOffset(min: number): string {
	const sign = min < 0 ? "-" : "+";
	const abs = Math.abs(min);
	const h = String(Math.floor(abs / 60)).padStart(2, "0");
	const m = String(abs % 60).padStart(2, "0");
	return `UTC${sign}${h}:${m}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div
			style={{
				background: "var(--bg2)",
				border: "1px solid var(--border)",
				borderRadius: 12,
				padding: 20,
				marginBottom: 16,
			}}
		>
			<h3
				style={{
					fontFamily: "var(--sans)",
					fontSize: 18,
					color: "var(--text)",
					marginBottom: 16,
				}}
			>
				{title}
			</h3>
			{children}
		</div>
	);
}

function SnippetBox({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	const copy = () => {
		try {
			navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast("Could not copy — select the text manually", "error");
		}
	};
	return (
		<div style={{ position: "relative" }}>
			<pre
				style={{
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: 8,
					padding: 14,
					paddingRight: 76,
					fontFamily: "var(--mono)",
					fontSize: 11,
					lineHeight: 1.6,
					overflowX: "auto",
					whiteSpace: "pre-wrap",
					wordBreak: "break-all",
					margin: 0,
					color: "var(--text2)",
				}}
			>
				{code}
			</pre>
			<button
				type="button"
				className="btn-pill"
				style={{ position: "absolute", top: 8, right: 8, fontSize: 11, padding: "4px 10px" }}
				onClick={copy}
			>
				{copied ? t("common.copied") : "Copy"}
			</button>
		</div>
	);
}

function WidgetPage() {
	const siteId = getActiveSiteId() ?? "";
	const qc = useQueryClient();
	const [mode, setMode] = useState<"bubble" | "badge">("bubble");

	const { data: status, isLoading } = useQuery({
		queryKey: ["widget", siteId],
		queryFn: () => fetchWidgetStatus(siteId),
		enabled: !!siteId,
	});

	const invalidate = () => qc.invalidateQueries({ queryKey: ["widget", siteId] });

	const toggleMut = useMutation({
		mutationFn: () => toggleWidget(siteId),
		onSuccess: invalidate,
	});
	const regenerateMut = useMutation({
		mutationFn: () => regenerateWidgetToken(siteId),
		onSuccess: () => {
			invalidate();
			toast(t("widget.regenerated"), "success");
		},
	});
	const tzMut = useMutation({
		mutationFn: (tzOffset: number) => updateWidgetConfig(siteId, { tz_offset: tzOffset }),
		onSuccess: invalidate,
	});

	if (!siteId) {
		return (
			<div className="empty-state" style={{ flex: 1 }}>
				<p>{t("sites.select_site")}</p>
			</div>
		);
	}

	if (isLoading) return <div className="spinner" />;

	const enabled = !!status?.enabled;
	const token = status?.widget_token ?? "";
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const snippet =
		mode === "badge"
			? `<script async src="${origin}/klikapa-live.js" data-widget-token="${token}" data-mode="badge"></script>`
			: `<script async src="${origin}/klikapa-live.js" data-widget-token="${token}"></script>`;

	// Suggest the admin's own browser offset as the "today" boundary.
	const browserOffset = -new Date().getTimezoneOffset();
	const tzValue = status?.tz_offset ?? browserOffset;

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<div className="overview-scroll">
				<PageHeader title={t("widget.title")} subtitle={t("widget.subtitle")} backTo="/settings" />

				<div style={{ maxWidth: 720 }}>
					<Section title={t("widget.title")}>
						<div
							style={{
								display: "flex",
								gap: 8,
								alignItems: "center",
								marginBottom: 12,
								flexWrap: "wrap",
							}}
						>
							<button
								type="button"
								className="btn-accent"
								style={{ fontSize: 12, padding: "6px 14px" }}
								onClick={() => toggleMut.mutate()}
								disabled={toggleMut.isPending}
							>
								{enabled ? t("widget.disable") : t("widget.enable")}
							</button>
							{enabled && (
								<span
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										padding: "4px 10px",
										borderRadius: 100,
										background: "var(--green-dim)",
										color: "var(--green)",
										border: "1px solid rgba(52,211,153,.2)",
									}}
								>
									{t("widget.enabled_badge")}
								</span>
							)}
							{enabled && (
								<button
									type="button"
									className="btn-pill"
									style={{ fontSize: 11, padding: "4px 10px" }}
									onClick={() => regenerateMut.mutate()}
									disabled={regenerateMut.isPending}
								>
									{t("widget.regenerate")}
								</button>
							)}
						</div>
						<div style={{ fontSize: 12, color: "var(--text3)" }}>{t("widget.hint")}</div>
					</Section>

					{enabled && (
						<>
							<Section title={t("widget.snippet")}>
								<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
									<button
										type="button"
										className={mode === "bubble" ? "btn-accent" : "btn-pill"}
										style={{ fontSize: 12, padding: "6px 14px" }}
										onClick={() => setMode("bubble")}
									>
										{t("widget.mode_bubble")}
									</button>
									<button
										type="button"
										className={mode === "badge" ? "btn-accent" : "btn-pill"}
										style={{ fontSize: 12, padding: "6px 14px" }}
										onClick={() => setMode("badge")}
									>
										{t("widget.mode_badge")}
									</button>
								</div>
								<SnippetBox code={snippet} />
							</Section>

							<Section title={t("widget.tz_offset")}>
								<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
									<select
										value={tzValue}
										style={{ fontSize: 12 }}
										onChange={(e) => tzMut.mutate(Number(e.target.value))}
										disabled={tzMut.isPending}
									>
										{TZ_OFFSETS.map((min) => (
											<option key={min} value={min}>
												{fmtOffset(min)}
												{min === browserOffset ? ` — ${fmtOffset(min)} (you)` : ""}
											</option>
										))}
									</select>
								</div>
								<div style={{ marginTop: 8, fontSize: 12, color: "var(--text3)" }}>
									{t("widget.tz_hint")}
								</div>
							</Section>

							<Section title="Tips">
								<ul
									style={{
										margin: 0,
										paddingLeft: 18,
										fontSize: 12,
										color: "var(--text3)",
										lineHeight: 1.9,
									}}
								>
									<li>{t("widget.tip_position")}</li>
									<li>{t("widget.tip_show")}</li>
									<li>{t("widget.tip_face")}</li>
									<li>{t("widget.tip_target")}</li>
									<li>{t("widget.tip_dark")}</li>
									<li>{t("widget.tip_refresh")}</li>
									<li>{t("widget.tip_hook")}</li>
								</ul>
							</Section>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

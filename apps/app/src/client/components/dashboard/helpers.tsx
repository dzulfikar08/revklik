// Layout and misc helpers

import { useState } from "react";
import type { Layout } from "react-grid-layout";
import { Globe } from "@/components/globe";
import { t } from "@/lib/i18n";

export const DEFAULT_LAYOUT = [
	{ i: "metrics", x: 0, y: 0, w: 12, h: 3, minW: 6, minH: 2 },
	{ i: "top-pages", x: 0, y: 3, w: 3, h: 5, minW: 3, minH: 2 },
	{ i: "chart", x: 3, y: 3, w: 6, h: 5, minW: 4, minH: 2 },
	{ i: "sources", x: 9, y: 3, w: 3, h: 5, minW: 3, minH: 2 },
	{ i: "locations", x: 0, y: 8, w: 3, h: 6, minW: 3, minH: 2 },
	{ i: "devices", x: 3, y: 8, w: 3, h: 6, minW: 3, minH: 2 },
	{ i: "funnel", x: 6, y: 8, w: 6, h: 6, minW: 4, minH: 2 },
	{ i: "recordings", x: 0, y: 14, w: 4, h: 6, minW: 3, minH: 2 },
	{ i: "journeys", x: 4, y: 14, w: 8, h: 8, minW: 6, minH: 2 },
	{ i: "ai-insights", x: 0, y: 22, w: 12, h: 4, minW: 6, minH: 1 },
	{ i: "revenue", x: 0, y: 26, w: 6, h: 5, minW: 4, minH: 2 },
	{ i: "event-usage", x: 6, y: 26, w: 6, h: 3, minW: 6, minH: 1 },
	{ i: "channels", x: 4, y: 18, w: 6, h: 4, minW: 4, minH: 2 },
	{ i: "entry-pages", x: 0, y: 26, w: 6, h: 5, minW: 4, minH: 2 },
	{ i: "predictions", x: 6, y: 29, w: 6, h: 5, minW: 4, minH: 2 },
	{ i: "campaigns", x: 0, y: 34, w: 12, h: 6, minW: 6, minH: 2 },
] as const satisfies Layout;

export function EmptyState({ siteId }: { siteId: string }) {
	const [copied, setCopied] = useState(false);
	const [promptCopied, setPromptCopied] = useState(false);
	const snippet = `<script defer data-site-id="${siteId}" src="${window.location.origin}/klikapa.js"></script>`;
	const agentPrompt = `Install RevKlik analytics on this website.

Site ID: ${siteId}

Fetch and follow the full setup guide, then implement it:
https://revklik.com/docs.txt`;

	return (
		<div
			className="detail-scroll"
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 0,
			}}
		>
			<Globe />
			<div style={{ textAlign: "center", marginTop: -80, maxWidth: 480 }}>
				<div
					style={{
						fontFamily: "var(--sans)",

						fontSize: 28,
						color: "var(--text)",
						marginBottom: 8,
					}}
				>
					{t("sites.waiting")}
				</div>
				<p
					style={{
						color: "var(--text3)",
						fontSize: 14,
						lineHeight: 1.6,
						marginBottom: 20,
					}}
				>
					{t("sites.script_hint")}
				</p>
				<div
					style={{
						background: "var(--bg2)",
						border: "1px solid var(--border)",
						borderRadius: 10,
						padding: "14px 18px",
						fontFamily: "var(--mono)",
						fontSize: 11,
						textAlign: "left",
						width: "100%",
						color: "var(--text2)",
						lineHeight: 1.8,
						wordBreak: "break-all",
						marginBottom: 16,
					}}
				>
					&lt;script defer data-site-id="{siteId}"<br />
					&nbsp;&nbsp;src="{window.location.origin}
					/klikapa.js"&gt;&lt;/script&gt;
				</div>
				<button
					type="button"
					className="btn-accent"
					onClick={() => {
						navigator.clipboard.writeText(snippet);
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
					}}
				>
					{copied ? t("common.copied") : t("common.copy_script")}
				</button>
				<div
					style={{
						marginTop: 28,
						width: "100%",
						textAlign: "left",
					}}
				>
					<div
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11,
							fontWeight: 600,
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							color: "var(--text2)",
							marginBottom: 8,
						}}
					>
						{t("sites.agent_title")}
					</div>
					<p
						style={{
							color: "var(--text3)",
							fontSize: 13,
							lineHeight: 1.6,
							marginBottom: 12,
						}}
					>
						{t("sites.agent_hint")}
					</p>
					<div
						style={{
							background: "var(--bg2)",
							border: "1px solid var(--border)",
							borderRadius: 10,
							padding: "14px 18px",
							fontFamily: "var(--mono)",
							fontSize: 11,
							color: "var(--text2)",
							lineHeight: 1.8,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							marginBottom: 12,
						}}
					>
						{agentPrompt}
					</div>
					<button
						type="button"
						className="btn-pill"
						onClick={() => {
							navigator.clipboard.writeText(agentPrompt);
							setPromptCopied(true);
							setTimeout(() => setPromptCopied(false), 2000);
						}}
					>
						{promptCopied ? t("common.copied") : t("sites.copy_agent_prompt")}
					</button>
				</div>
				<div
					style={{
						marginTop: 16,
						fontSize: 12,
						color: "var(--text3)",
					}}
				>
					{t("sites.full_docs")}{" "}
					<a
						href="https://revklik.com/docs.txt"
						target="_blank"
						rel="noopener"
						style={{ color: "var(--accent)" }}
					>
						docs.txt
					</a>
					{" · "}
					<a
						href="https://revklik.com/docs.html"
						target="_blank"
						rel="noopener"
						style={{ color: "var(--accent)" }}
					>
						docs.html
					</a>
				</div>
			</div>
		</div>
	);
}

export function CollapsibleSection({
	title,
	defaultOpen,
	children,
}: {
	title: string;
	defaultOpen: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div style={{ marginBottom: 16 }}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					width: "100%",
					padding: "10px 0",
					background: "none",
					border: "none",
					cursor: "pointer",
					color: "var(--text2)",
					fontSize: 13,
					fontWeight: 600,
					fontFamily: "var(--mono)",
					textTransform: "uppercase",
					letterSpacing: "0.06em",
				}}
			>
				<span
					style={{
						transition: "transform 0.15s",
						transform: open ? "rotate(90deg)" : "rotate(0)",
						display: "inline-block",
						fontSize: 10,
					}}
				>
					&#9656;
				</span>
				{title}
			</button>
			{open && children}
		</div>
	);
}

export function loadLayout(siteId: string): Layout {
	try {
		const saved = localStorage.getItem(`kp_layout_${siteId}`);
		if (saved) return JSON.parse(saved);
	} catch {
		/* ignore */
	}
	return DEFAULT_LAYOUT as unknown as Layout;
}

export function toMobileLayout(layout: Layout, cols: number): Layout {
	let y = 0;
	return layout.map((item) => {
		const h = item.h;
		const mobileItem = { ...item, x: 0, w: cols, y };
		y += h;
		return mobileItem;
	});
}

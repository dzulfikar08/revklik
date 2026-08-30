import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { fetchWidgetStatus, getActiveSiteId } from "@/lib/api";

export const Route = createFileRoute("/docs/install")({
	component: InstallGuidePage,
});

const PLATFORMS = [
	{ key: "html", name: "HTML" },
	{ key: "wordpress", name: "WordPress" },
	{ key: "nextjs", name: "Next.js" },
	{ key: "webflow", name: "Webflow" },
	{ key: "ghost", name: "Ghost" },
	{ key: "shopify", name: "Shopify" },
	{ key: "wix", name: "Wix" },
	{ key: "squarespace", name: "Squarespace" },
	{ key: "nuxt", name: "Nuxt" },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

function LiveWidgetSection() {
	const navigate = useNavigate();
	const siteId = getActiveSiteId();
	const [copied, setCopied] = useState(false);

	const { data: status } = useQuery({
		queryKey: ["widget", siteId],
		queryFn: () => fetchWidgetStatus(siteId as string),
		enabled: !!siteId,
	});

	const enabled = !!status?.enabled && !!status.widget_token;
	const snippet = `<script async src="${window.location.origin}/klikapa-live.js" data-widget-token="${status?.widget_token ?? "YOUR_WIDGET_TOKEN"}"></script>`;

	return (
		<div
			style={{
				marginTop: 24,
				background: "var(--bg2)",
				border: "1px solid var(--border)",
				borderRadius: 12,
				padding: 20,
			}}
		>
			<div
				style={{
					fontSize: 13,
					color: "var(--text2)",
					marginBottom: 8,
					fontWeight: 600,
				}}
			>
				Bonus: Live Widget
			</div>
			<p style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, margin: "0 0 12px" }}>
				Show live numbers on your website &mdash; visitors online, visitors today, and the all-time
				total. Numbers refresh automatically every 30 seconds. On the floating bubble, add{" "}
				<code>data-face="online,total"</code> to pin stats onto the pill itself.
			</p>
			{enabled ? (
				<div>
					<pre
						style={{
							background: "var(--bg3)",
							borderRadius: 8,
							padding: 14,
							fontFamily: "var(--mono)",
							fontSize: 13,
							overflowX: "auto",
							position: "relative",
							color: "var(--text)",
							lineHeight: 1.6,
							margin: 0,
						}}
					>
						{snippet}
						<button
							type="button"
							onClick={() => {
								navigator.clipboard.writeText(snippet);
								setCopied(true);
								setTimeout(() => setCopied(false), 2000);
							}}
							style={{
								position: "absolute",
								top: 8,
								right: 8,
								background: "var(--bg4)",
								border: "1px solid var(--border2)",
								borderRadius: 6,
								padding: "4px 10px",
								fontFamily: "var(--sans)",
								fontSize: 11,
								color: copied ? "var(--green)" : "var(--text3)",
								cursor: "pointer",
								transition: "color 0.2s",
							}}
						>
							{copied ? "Copied!" : "Copy"}
						</button>
					</pre>
					<p style={{ fontSize: 12, color: "var(--text3)", marginTop: 10, margin: "10px 0 0" }}>
						This is the floating bubble variant. For an inline badge, options (corner position,
						which numbers show), and the timezone setting, see{" "}
						<button
							type="button"
							style={{
								background: "none",
								border: "none",
								padding: 0,
								color: "var(--accent)",
								cursor: "pointer",
								fontSize: 12,
								textDecoration: "underline",
							}}
							onClick={() => navigate({ to: "/settings/widget" })}
						>
							Settings &rarr; Live Widget
						</button>
						.
					</p>
				</div>
			) : (
				<button
					type="button"
					className="btn-accent"
					style={{ fontSize: 12, padding: "6px 14px" }}
					onClick={() => navigate({ to: "/settings/widget" })}
				>
					Enable in Settings &rarr; Live Widget
				</button>
			)}
		</div>
	);
}

const PLATFORM_STEPS: Record<PlatformKey, string> = {
	html: "Add the script tag to your HTML <head> section, before the closing </head> tag.",
	wordpress:
		"Install the 'Insert Headers and Footers' plugin. Go to Settings \u2192 Insert Headers and Footers and paste the script in the Scripts in Header section. Alternatively, add it to your theme's header.php file.",
	nextjs:
		"Create a file at app/layout.tsx (or pages/_document.tsx for Pages Router) and add the script to the <Head> component. For App Router, use next/script with strategy='afterInteractive'.",
	webflow:
		"Go to Project Settings \u2192 Custom Code \u2192 Footer Code. Paste the script and save. Publish your site.",
	ghost: "Go to Settings \u2192 Code Injection \u2192 Site Header. Paste the script and save.",
	shopify:
		"Go to Online Store \u2192 Themes \u2192 Actions \u2192 Edit Code. Open theme.liquid and add the script before </head>.",
	wix: "Go to Settings \u2192 Custom Code \u2192 Header. Add a new custom code block and paste the script.",
	squarespace:
		"Go to Settings \u2192 Advanced \u2192 Code Injection \u2192 Header. Paste the script and save.",
	nuxt: "Add the script to nuxt.config.ts in the head.script array, or create a plugin in plugins/ directory.",
};

function InstallGuidePage() {
	const siteId = getActiveSiteId() ?? "YOUR_SITE_ID";
	const [activePlatform, setActivePlatform] = useState<PlatformKey>("html");
	const [copied, setCopied] = useState(false);

	const snippetUrl = `${window.location.origin}/api/klikapa.js?site_id=${siteId}`;
	const snippet = `<script defer src="${snippetUrl}"></script>`;

	const handleCopy = () => {
		navigator.clipboard.writeText(snippet);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 16px" }}>
			<PageHeader
				title="Install Guide"
				subtitle="Get started with RevKlik in under 2 minutes"
				backTo={siteId !== "YOUR_SITE_ID" ? "/site/$siteId" : "/"}
			/>

			{/* Platform tabs */}
			<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
				{PLATFORMS.map((p) => (
					<button
						type="button"
						key={p.key}
						className="btn-pill"
						style={
							activePlatform === p.key
								? { background: "var(--accent-dim)", color: "var(--accent)" }
								: {}
						}
						onClick={() => setActivePlatform(p.key)}
					>
						{p.name}
					</button>
				))}
			</div>

			{/* Tracking snippet */}
			<div style={{ marginBottom: 24 }}>
				<div
					style={{
						fontSize: 13,
						color: "var(--text2)",
						marginBottom: 8,
						fontWeight: 600,
					}}
				>
					Tracking snippet
				</div>
				<pre
					style={{
						background: "var(--bg3)",
						borderRadius: 8,
						padding: 14,
						fontFamily: "var(--mono)",
						fontSize: 13,
						overflowX: "auto",
						position: "relative",
						color: "var(--text)",
						lineHeight: 1.6,
						margin: 0,
					}}
				>
					{snippet}
					<button
						type="button"
						onClick={handleCopy}
						style={{
							position: "absolute",
							top: 8,
							right: 8,
							background: "var(--bg4)",
							border: "1px solid var(--border2)",
							borderRadius: 6,
							padding: "4px 10px",
							fontFamily: "var(--sans)",
							fontSize: 11,
							color: copied ? "var(--green)" : "var(--text3)",
							cursor: "pointer",
							transition: "color 0.2s",
						}}
					>
						{copied ? "Copied!" : "Copy"}
					</button>
				</pre>
			</div>

			{/* Platform-specific instructions */}
			<div
				style={{
					background: "var(--bg2)",
					border: "1px solid var(--border)",
					borderRadius: 12,
					padding: 20,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						marginBottom: 12,
					}}
				>
					<div
						style={{
							width: 32,
							height: 32,
							borderRadius: 8,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							background: "var(--accent-dim)",
							color: "var(--accent)",
							fontWeight: 700,
							fontSize: 13,
							fontFamily: "var(--mono)",
						}}
					>
						{PLATFORMS.find((p) => p.key === activePlatform)?.name.charAt(0)}
					</div>
					<div
						style={{
							fontFamily: "var(--sans)",

							fontSize: 18,
							color: "var(--text)",
						}}
					>
						{PLATFORMS.find((p) => p.key === activePlatform)?.name}
					</div>
				</div>
				<p
					style={{
						fontSize: 13,
						color: "var(--text2)",
						lineHeight: 1.7,
						margin: 0,
					}}
				>
					{PLATFORM_STEPS[activePlatform]}
				</p>
			</div>

			{/* Live widget section */}
			<LiveWidgetSection />

			{/* Verification note */}
			<div
				style={{
					marginTop: 20,
					padding: 14,
					borderRadius: 8,
					background: "var(--green-dim)",
					fontSize: 12,
					color: "var(--green)",
					lineHeight: 1.6,
				}}
			>
				<strong>Tip:</strong> After adding the script, visit your site and check back here &mdash;
				you should see your first visitor appear within seconds.
			</div>
		</div>
	);
}

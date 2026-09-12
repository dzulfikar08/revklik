import type { APIRoute } from "astro";
import { createElement } from "react";
import { ImageResponse } from "takumi-js/response";

import { source } from "@/lib/source";

export function getStaticPaths() {
	return source.getPages().map((page) => ({
		params: {
			slug: page.slugs.length > 0 ? page.slugs.join("/") : undefined,
		},
	}));
}

// klikapa palette (oklch values from apps/web/src/index.css, flattened to hex
// so the OG renderer never has to parse modern color functions).
const BRAND = {
	background: "#0b0e14",
	foreground: "#edf0f4",
	mutedForeground: "#949aa3",
	border: "#242931",
	accent: "#f7a062",
} as const;

const el = (
	tag: string,
	style: Record<string, string | number>,
	...children: (string | React.ReactElement)[]
) => createElement(tag, { style }, ...children);

function Card({ title, description }: { title: string; description?: string }) {
	return el(
		"div",
		{
			display: "flex",
			flexDirection: "column",
			width: "100%",
			height: "100%",
			padding: "64px 72px 56px",
			backgroundColor: BRAND.background,
			borderBottom: `14px solid ${BRAND.accent}`,
			color: BRAND.foreground,
		},
		el(
			"div",
			{ display: "flex", alignItems: "baseline", gap: "8px" },
			el("span", { fontSize: "44px", fontWeight: 700, letterSpacing: "-1px" }, "klikapa"),
			el("span", { fontSize: "44px", fontWeight: 700, color: BRAND.accent }, "."),
			el("span", { fontSize: "30px", fontWeight: 500, color: BRAND.mutedForeground }, "docs"),
		),
		el(
			"div",
			{
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				flex: 1,
			},
			el(
				"div",
				{
					fontSize: title.length > 30 ? "64px" : "80px",
					fontWeight: 800,
					lineHeight: 1.1,
				},
				title,
			),
			description
				? el(
						"div",
						{
							fontSize: "32px",
							color: BRAND.mutedForeground,
							marginTop: "24px",
							lineHeight: 1.4,
						},
						description,
					)
				: null,
		),
		el(
			"div",
			{
				display: "flex",
				alignItems: "center",
				gap: "16px",
				borderTop: `2px solid ${BRAND.border}`,
				paddingTop: "28px",
			},
			el("span", { fontSize: "28px", fontWeight: 600, color: BRAND.accent }, "docs.revklik.com"),
			el(
				"span",
				{ fontSize: "24px", color: BRAND.mutedForeground },
				"Privacy-first web & revenue analytics",
			),
		),
	);
}

export const GET: APIRoute = ({ params }) => {
	const slugs = params.slug?.split("/").filter((item) => item.length > 0) ?? [];
	const page = source.getPage(slugs);

	if (!page) return new Response(undefined, { status: 404 });

	return new ImageResponse(
		createElement(Card, {
			title: page.data.title,
			description: page.data.description,
		}),
		{
			width: 1200,
			height: 630,
			format: "png",
		},
	);
};

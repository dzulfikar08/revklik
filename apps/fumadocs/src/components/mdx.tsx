import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { ComponentProps } from "react";

import { type Locale, withTrailingSlash } from "@/lib/i18n";

const COPY_LABELS: Record<Locale, { copy: string; copied: string }> = {
	en: { copy: "Copy code", copied: "Copied" },
	id: { copy: "Salin kode", copied: "Tersalin" },
};

const DefaultAnchor = defaultMdxComponents.a;
const DefaultCard = defaultMdxComponents.Card;

/** Internal links point at the directory URL Astro serves, so they never hop a redirect. */
function localizeHref<T extends string | undefined>(href: T): T | string {
	if (typeof href !== "string") return href;
	if (!href.startsWith("/") || href.startsWith("//")) return href;

	return withTrailingSlash(href);
}

function Anchor(props: ComponentProps<"a">) {
	return <DefaultAnchor {...props} href={localizeHref(props.href)} />;
}

function Card(props: ComponentProps<typeof DefaultCard>) {
	return <DefaultCard {...props} href={localizeHref(props.href)} />;
}

function CopyCodeButton({ locale }: { locale: Locale }) {
	const labels = COPY_LABELS[locale];

	return (
		<button
			type="button"
			data-copy-code=""
			data-label-copy={labels.copy}
			data-label-copied={labels.copied}
			aria-label={labels.copy}
			className="inline-flex size-8 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-2 focus-visible:outline-fd-ring data-[checked]:text-fd-primary"
		>
			<svg
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<rect x="8" y="2" width="8" height="4" rx="1" />
				<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
			</svg>
		</button>
	);
}

/**
 * MDX components for the Astro build. The content renders as static HTML, so the
 * stock Fumadocs copy button never hydrates; this one is a plain button that the
 * click handler in layout.astro wires up.
 */
export function createMdxComponents(locale: Locale) {
	function CodeFigure(props: ComponentProps<"pre">) {
		return (
			<CodeBlock
				{...props}
				allowCopy={false}
				Actions={({ className }) => (
					<div className={className}>
						<CopyCodeButton locale={locale} />
					</div>
				)}
			>
				<Pre>{props.children}</Pre>
			</CodeBlock>
		);
	}

	return {
		...defaultMdxComponents,
		a: Anchor,
		Card,
		pre: CodeFigure,
	};
}

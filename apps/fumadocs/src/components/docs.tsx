import { navigate } from "astro:transitions/client";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";

import { i18n, type Locale } from "@/lib/i18n";

import { BrandLockup } from "./brand-lockup";
import { LanguageToggle, type LanguageLink } from "./language-toggle";
import SearchDialog from "./search";

export function Docs({
	tree,
	children,
	pathname,
	params,
	page,
	locale,
	languageLinks,
}: {
	tree: Root;
	children: ReactNode;
	pathname: string;
	params: AstroProviderProps["params"];
	page?: DocsPageProps;
	locale: Locale;
	languageLinks: LanguageLink[];
}) {
	return (
		<RootProvider
			pathname={pathname}
			params={params}
			navigate={navigate}
			theme={{ enabled: false }}
			search={{ SearchDialog }}
			i18n={i18n.provider(locale)}
		>
			<DocsLayout
				tree={tree}
				themeSwitch={{
					enabled: false,
				}}
				slots={{ languageSelect: false }}
				nav={{
					title: (
						<a
							href="https://app.revklik.com"
							aria-label="RevKlik"
							className="text-fd-foreground inline-flex items-center"
						>
							<BrandLockup className="h-6 w-auto" />
						</a>
					),
					children: <LanguageToggle locale={locale} links={languageLinks} />,
				}}
			>
				<DocsPage {...page}>{children}</DocsPage>
			</DocsLayout>
		</RootProvider>
	);
}

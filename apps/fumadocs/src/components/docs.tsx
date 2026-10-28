import { navigate } from "astro:transitions/client";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";

import { BrandLockup } from "./brand-lockup";
import SearchDialog from "./search";

export function Docs({
	tree,
	children,
	pathname,
	params,
	page,
}: {
	tree: Root;
	children: ReactNode;
	pathname: string;
	params: AstroProviderProps["params"];
	page?: DocsPageProps;
}) {
	return (
		<RootProvider
			pathname={pathname}
			params={params}
			navigate={navigate}
			theme={{ enabled: false }}
			search={{ SearchDialog }}
		>
			<DocsLayout
				tree={tree}
				themeSwitch={{
					enabled: false,
				}}
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
				}}
			>
				<DocsPage {...page}>{children}</DocsPage>
			</DocsLayout>
		</RootProvider>
	);
}

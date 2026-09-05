import { navigate } from "astro:transitions/client";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";

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
              className="text-fd-foreground inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"
            >
              <img
                alt="klikapa logo"
                className="ring-fd-border size-7 rounded-lg object-cover ring-1"
                src="/revklik.webp"
              />
              klikapa
            </a>
          ),
        }}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}

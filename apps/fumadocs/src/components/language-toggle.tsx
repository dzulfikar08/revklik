import { LOCALE_LABELS, type Locale } from "@/lib/i18n";

export interface LanguageLink {
	locale: Locale;
	url: string;
}

const GROUP_LABEL: Record<Locale, string> = {
	en: "Language",
	id: "Bahasa",
};

/**
 * EN/ID switch for the docs navigation. Plain links to the same page in the other
 * language: crawlable, keyboard reachable, and no client state to drift out of sync.
 */
export function LanguageToggle({ locale, links }: { locale: Locale; links: LanguageLink[] }) {
	if (links.length < 2) return null;

	return (
		<div className="flex flex-1 justify-end">
			<nav
				aria-label={GROUP_LABEL[locale]}
				className="inline-flex items-center gap-0.5 rounded-lg border bg-fd-secondary/50 p-0.5 text-xs font-medium"
			>
				{links.map((link) => {
					const label = LOCALE_LABELS[link.locale];
					const active = link.locale === locale;

					return (
						<a
							key={link.locale}
							href={link.url}
							hrefLang={label.htmlLang}
							lang={label.htmlLang}
							title={label.name}
							aria-label={`${label.short}: ${label.name}`}
							aria-current={active ? "true" : undefined}
							className={
								active
									? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-fd-primary px-3 text-fd-primary-foreground md:min-h-8 md:min-w-9"
									: "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground md:min-h-8 md:min-w-9"
							}
						>
							{label.short}
						</a>
					);
				})}
			</nav>
		</div>
	);
}

import { BrandMark } from "@revklik/ui/components/brand-mark";
import { buttonVariants } from "@revklik/ui/components/button";
import { cn } from "@revklik/ui/lib/utils";
import type { ReactNode } from "react";

import { LocaleToggle } from "@/components/locale-toggle";
import { docsUrl, marketingUrl, useAuthDocumentTitle } from "@/lib/auth-page";
import type { AuthPage } from "@/lib/auth-page";
import { useLocale, useT } from "@/lib/i18n";

const footerLinkClass =
	"text-muted-foreground hover:text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center rounded-sm px-2.5 text-xs underline-offset-4 outline-offset-[-2px] transition-colors duration-150 hover:underline focus-visible:outline-2";

/** Legal and help links at the foot of every signed-out page; same-tab, like the consent line. */
const AuthFooter = () => {
	const locale = useLocale();
	const t = useT();
	const links = [
		{ href: marketingUrl(locale, "privacy"), label: t("auth.footer.privacy") },
		{ href: marketingUrl(locale, "terms"), label: t("auth.footer.terms") },
		{ href: marketingUrl(locale, "support"), label: t("auth.footer.support") },
		{ href: docsUrl(locale), label: t("auth.footer.docs") },
	];
	return (
		<footer className="px-4 pb-4">
			<nav aria-label={t("auth.footer.label")}>
				<ul className="flex flex-wrap items-center justify-center">
					{links.map((link) => (
						<li key={link.href}>
							<a href={link.href} className={footerLinkClass}>
								{link.label}
							</a>
						</li>
					))}
				</ul>
			</nav>
		</footer>
	);
};

/**
 * Centered card shell shared by sign-in, sign-up, forgot, reset, verify and
 * the 404. The ID/EN toggle sits in a top bar (top-right, like the billing
 * header) so it never overlaps the card on a phone. One ring, no shadow:
 * the card sits on the page, it does not float over it. `aside` (sign-up's
 * trial panel) stacks under the card on narrow screens and sits to its left
 * from 1024px; it carries no controls, so tab order stays card-first.
 */
export const AuthShell = ({
	title,
	description,
	eyebrow,
	page,
	aside,
	children,
}: {
	title: string;
	description: ReactNode;
	/** Small line above the title, e.g. the 404 status code. */
	eyebrow?: ReactNode;
	/** Sets the localized tab title; omit for pages that keep the default. */
	page?: AuthPage;
	aside?: ReactNode;
	children: ReactNode;
}) => {
	const locale = useLocale();
	const t = useT();
	useAuthDocumentTitle(page);
	return (
		<div className="bg-background text-foreground flex min-h-svh flex-col">
			<div className="flex justify-end px-3 py-3 md:px-4">
				<LocaleToggle />
			</div>
			<main className="grid flex-1 place-items-center px-4 pt-4 pb-10">
				<div
					className={
						aside
							? "grid w-full max-w-sm gap-8 lg:max-w-4xl lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center lg:gap-16"
							: "w-full max-w-sm"
					}
				>
					<section className="bg-card ring-foreground/10 w-full rounded-2xl px-5 py-7 ring-1 sm:px-7">
						<header className="flex flex-col items-center text-center">
							<a
								href={marketingUrl(locale, "")}
								aria-label={t("auth.logoHome")}
								className="focus-visible:outline-ring -m-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1 outline-offset-2 focus-visible:outline-2"
							>
								<BrandMark className="h-10 w-auto" />
							</a>
							{eyebrow ? (
								<p className="text-muted-foreground mt-3 text-xs font-medium tabular-nums">
									{eyebrow}
								</p>
							) : null}
							<h1 className={`${eyebrow ? "mt-1" : "mt-3"} text-xl font-semibold tracking-tight`}>
								{title}
							</h1>
							<div className="text-muted-foreground mt-1.5 text-sm text-balance">{description}</div>
						</header>
						<div className="mt-6 grid gap-4">{children}</div>
					</section>
					{aside ? <div className="lg:order-first">{aside}</div> : null}
				</div>
			</main>
			<AuthFooter />
		</div>
	);
};

/** Text links in the auth card: quiet underline that firms up on hover. */
export const authLinkClass =
	"text-foreground font-medium underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring rounded-sm";

/** 40px fields and buttons, 14px text: comfortable thumbs, readable on phones. */
export const authInputClass = "h-10 px-3 text-sm md:text-sm focus-visible:ring-2";
export const authButtonClass = "h-10 w-full text-sm";

/**
 * The one orange action per auth screen: the same accent and dark label as
 * the landing page's primary button, so the step from revklik.com to sign-up
 * does not change color. Neutral variants stay for secondary actions.
 */
export const authPrimaryClass = `${authButtonClass} bg-[oklch(0.78_0.13_55)] text-[oklch(0.2_0.016_260)] hover:bg-[oklch(0.83_0.13_55)]`;

/** The same primary look for a router `<Link>`; cn lets the accent win over the default variant. */
export const authPrimaryLinkClass = cn(buttonVariants(), authPrimaryClass);

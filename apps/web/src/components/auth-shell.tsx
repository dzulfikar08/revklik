import { BrandMark } from "@revklik/ui/components/brand-mark";
import type { ReactNode } from "react";

import { LocaleToggle } from "@/components/locale-toggle";

/**
 * Centered card shell shared by sign-in, sign-up, forgot, reset, verify and
 * the 404. The ID/EN toggle sits in a top bar (top-right, like the billing
 * header) so it never overlaps the card on a phone. One ring, no shadow:
 * the card sits on the page, it does not float over it.
 */
export const AuthShell = ({
	title,
	description,
	eyebrow,
	children,
}: {
	title: string;
	description: ReactNode;
	/** Small line above the title, e.g. the 404 status code. */
	eyebrow?: ReactNode;
	children: ReactNode;
}) => (
	<div className="bg-background text-foreground flex min-h-svh flex-col">
		<div className="flex justify-end px-3 py-3 md:px-4">
			<LocaleToggle />
		</div>
		<main className="grid flex-1 place-items-center px-4 pt-4 pb-16">
			<section className="bg-card ring-foreground/10 w-full max-w-sm rounded-2xl px-5 py-7 ring-1 sm:px-7">
				<header className="flex flex-col items-center text-center">
					<BrandMark role="img" aria-label="RevKlik" aria-hidden={false} className="h-10 w-auto" />
					{eyebrow ? (
						<p className="text-muted-foreground mt-4 text-xs font-medium tabular-nums">{eyebrow}</p>
					) : null}
					<h1 className={`${eyebrow ? "mt-1" : "mt-4"} text-xl font-semibold tracking-tight`}>
						{title}
					</h1>
					<div className="text-muted-foreground mt-1.5 text-sm text-balance">{description}</div>
				</header>
				<div className="mt-6 grid gap-4">{children}</div>
			</section>
		</main>
	</div>
);

/** Text links in the auth card: quiet underline that firms up on hover. */
export const authLinkClass =
	"text-foreground font-medium underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring rounded-sm";

/** 40px fields and buttons, 14px text: comfortable thumbs, readable on phones. */
export const authInputClass = "h-10 px-3 text-sm md:text-sm focus-visible:ring-2";
export const authButtonClass = "h-10 w-full text-sm";

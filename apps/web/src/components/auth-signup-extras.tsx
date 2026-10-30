import { authLinkClass } from "@/components/auth-shell";
import { marketingUrl } from "@/lib/auth-page";
import { useLocale, useT } from "@/lib/i18n";

/**
 * Under the sign-up button: agreement to the hosted terms and privacy
 * policy. Both open in this tab. Not shown on self-hosted instances, where
 * the hosted service's terms do not apply.
 */
export const SignupConsent = () => {
	const locale = useLocale();
	const t = useT();
	return (
		<p className="text-muted-foreground text-center text-xs leading-relaxed text-balance">
			{t("auth.consent.before")}{" "}
			<a href={marketingUrl(locale, "terms")} className={authLinkClass}>
				{t("auth.consent.terms")}
			</a>{" "}
			{t("auth.consent.and")}{" "}
			<a href={marketingUrl(locale, "privacy")} className={authLinkClass}>
				{t("auth.consent.privacy")}
			</a>
			.
		</p>
	);
};

/**
 * What the 7-day trial opens up. Three plain bullets, each a feature that
 * ships on the Growth plan; no numbers, no customer claims.
 */
export const TrialValuePanel = () => {
	const t = useT();
	return (
		<section aria-labelledby="trial-value-title" className="px-1 lg:px-0">
			<h2 id="trial-value-title" className="text-lg font-semibold tracking-tight lg:text-2xl">
				{t("auth.value.title")}
			</h2>
			<ul className="text-muted-foreground mt-3 grid list-disc gap-2.5 ps-5 text-sm marker:text-[oklch(0.78_0.13_55)] lg:mt-5 lg:text-base">
				<li>{t("auth.value.attribution")}</li>
				<li>{t("auth.value.funnels")}</li>
				<li>{t("auth.value.replay")}</li>
			</ul>
		</section>
	);
};

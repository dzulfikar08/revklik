import { Button } from "@revklik/ui/components/button";
import { Lock } from "lucide-react";

import { LocaleToggle } from "@/components/locale-toggle";
import { useT } from "@/lib/i18n";
import type { LegacyApiError } from "@/lib/legacy/api";
import { IDR_PRICE, USD_PRICE, subscriptionState } from "@/lib/legacy/billing";

import { usePlans, useSubscription } from "./billing-view";
import { money } from "./data";

/**
 * Full-panel lock for a lapsed account (gated reads answer 402). Billing
 * stays reachable through `onUpgrade`; during the grace period the copy
 * says how long visits keep being recorded.
 */
export const UpgradeLock = ({
	error,
	onUpgrade,
}: {
	error?: LegacyApiError | null;
	onUpgrade: () => void;
}) => {
	const t = useT();
	const { data: sub } = useSubscription();
	const { data: plans } = usePlans();
	const state = sub ? subscriptionState(sub) : null;
	const graceDays = error?.body?.grace_days_remaining ?? state?.graceDaysLeft ?? 0;
	// Same rule as the billing view: QRIS-eligible visitors see IDR.
	const startingPrice = plans?.qris_available
		? money(IDR_PRICE.micro, "IDR")
		: money(USD_PRICE.micro);

	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<section
				aria-labelledby="upgrade-lock-title"
				className="bg-card ring-foreground/10 flex min-h-[60svh] flex-col items-center justify-center gap-3 rounded-2xl px-6 py-12 text-center ring-1"
			>
				<span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl">
					<Lock className="size-5" aria-hidden />
				</span>
				<h1 id="upgrade-lock-title" className="text-lg font-semibold tracking-tight">
					{t("lock.title")}
				</h1>
				<div className="text-muted-foreground max-w-md space-y-1.5 text-sm">
					<p>{state?.trialing ? t("lock.trialEnded") : t("lock.lapsed")}</p>
					<p>{graceDays > 0 ? t("lock.grace", { n: graceDays }) : t("lock.stopped")}</p>
				</div>
				<Button className="mt-2 h-10 px-4" onClick={onUpgrade}>
					{t("lock.cta")}
				</Button>
				<p className="text-muted-foreground text-xs">{t("lock.from", { price: startingPrice })}</p>
				<LocaleToggle className="mt-4" />
			</section>
		</main>
	);
};

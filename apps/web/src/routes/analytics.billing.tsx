import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { BillingView } from "@/components/analytics/billing-view";
import { LocaleToggle } from "@/components/locale-toggle";
import { useT } from "@/lib/i18n";
import { parseCheckoutResult, parsePlan } from "@/lib/legacy/billing";
import type { CheckoutResult, PlanTier } from "@/lib/legacy/billing";

interface BillingSearch {
	plan?: PlanTier;
	checkout?: CheckoutResult;
}

/**
 * Site-independent billing page: reachable before the first site exists
 * (fresh signups with ?plan=), from checkout returns, and from the upgrade
 * lock. Static segment, so it wins over /analytics/$siteId.
 */
export const Route = createFileRoute("/analytics/billing")({
	validateSearch: (search: Record<string, unknown>): BillingSearch => {
		const out: BillingSearch = {};
		const plan = parsePlan(search.plan);
		const checkout = parseCheckoutResult(search.checkout);
		if (plan) out.plan = plan;
		if (checkout) out.checkout = checkout;
		return out;
	},
	component: BillingPage,
	head: () => ({ meta: [{ title: "Billing · RevKlik" }] }),
});

function BillingPage() {
	const t = useT();
	const { plan, checkout } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<div className="bg-background text-foreground min-h-svh">
			<header className="border-border/60 border-b">
				<div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 md:px-4">
					<Link
						to="/analytics"
						className="hover:bg-accent focus-visible:outline-ring -m-1 flex min-h-11 items-center gap-2.5 rounded-lg p-1 pe-2 outline-offset-2 transition-colors focus-visible:outline-2"
					>
						<ArrowLeft className="text-muted-foreground size-4" aria-hidden />
						<img
							src="/revklik.webp"
							alt=""
							className="ring-foreground/10 size-7 rounded-lg object-cover ring-1"
						/>
						<span className="text-[15px] font-semibold tracking-tight">RevKlik</span>
						<span className="text-muted-foreground text-xs">· {t("billing.back")}</span>
					</Link>
					<LocaleToggle className="ms-auto" />
				</div>
			</header>
			<BillingView
				localeToggle={false}
				highlightPlan={plan}
				checkout={checkout}
				onCheckoutHandled={() =>
					void navigate({ replace: true, search: (prev) => ({ ...prev, checkout: undefined }) })
				}
			/>
		</div>
	);
}

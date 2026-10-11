import { Button } from "@revklik/ui/components/button";
import { AlertTriangle, Clock, MailWarning, X } from "lucide-react";

import { useT } from "@/lib/i18n";

import { useSubscriptionNotice } from "./billing-view";
import { useVerifyNotice } from "./verify-email-banner";

const DismissButton = ({ onClick }: { onClick: () => void }) => {
	const t = useT();
	return (
		<button
			type="button"
			aria-label={t("billing.dismiss")}
			onClick={onClick}
			className="text-muted-foreground hover:text-foreground focus-visible:outline-ring pointer-coarse:size-10 -my-1 -me-1 flex size-7 shrink-0 items-center justify-center rounded-md outline-offset-2 transition-colors duration-150 focus-visible:outline-2"
		>
			<X className="size-3.5" aria-hidden />
		</button>
	);
};

/**
 * One notice area for account state above the sites overview and the
 * dashboard: the plan line (trial countdown or a billing warning, with the
 * "Choose a plan" CTA) leads, the verify-email reminder sits under it as a
 * quieter second line. Each line dismisses on its own for the session.
 */
export const AccountNotices = ({ onUpgrade }: { onUpgrade: () => void }) => {
	const t = useT();
	const plan = useSubscriptionNotice();
	const verify = useVerifyNotice();
	if (!plan && !verify) return null;

	const warn = plan?.warn ?? false;
	const PlanIcon = warn ? AlertTriangle : Clock;

	return (
		<section
			aria-label={t("notices.label")}
			className={`divide-border mb-3 divide-y rounded-xl text-xs ring-1 ${
				warn ? "bg-(--down)/[0.06] ring-(--down)/30" : "bg-card ring-foreground/10"
			}`}
		>
			{plan ? (
				<div className="flex items-center gap-2.5 px-3 py-2" role="status">
					<PlanIcon
						className={`size-3.5 shrink-0 ${warn ? "text-(--down)" : "text-(--chart)"}`}
						aria-hidden
					/>
					<p className="text-foreground min-w-0 flex-1 leading-snug">{plan.message}</p>
					<Button size="sm" className="pointer-coarse:h-10 h-7 shrink-0 px-3" onClick={onUpgrade}>
						{t("lock.cta")}
					</Button>
					<DismissButton onClick={plan.dismiss} />
				</div>
			) : null}
			{verify ? (
				<div className="flex items-center gap-2.5 px-3 py-1.5" role="status">
					<MailWarning className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
					{/* Phones get the short line so the reminder stays one row high. */}
					<p className="text-muted-foreground min-w-0 flex-1 leading-snug">
						<span className="sm:hidden">{t("verify.bannerShort")}</span>
						<span className="hidden sm:inline">{t("verify.banner", { email: verify.email })}</span>
					</p>
					<button
						type="button"
						disabled={verify.resending || verify.resent}
						onClick={verify.resend}
						className="text-foreground decoration-foreground/40 hover:decoration-foreground focus-visible:outline-ring pointer-coarse:min-h-10 shrink-0 rounded-sm px-1 font-medium underline underline-offset-4 outline-offset-2 transition-colors duration-150 focus-visible:outline-2 disabled:no-underline disabled:opacity-70"
					>
						{verify.resent ? t("verify.resent") : t("verify.resend")}
					</button>
					<DismissButton onClick={verify.dismiss} />
				</div>
			) : null}
		</section>
	);
};

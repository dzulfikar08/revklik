import { Button } from "@revklik/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MailWarning, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import { fetchMe, resendVerification } from "@/lib/legacy/api";

const DISMISS_KEY = "kp_verify_banner_dismissed";

/**
 * Shown while /auth/me reports email_verified: false. Missing field (older
 * worker) counts as verified. Dismissal lasts for the browser session.
 */
export const VerifyEmailBanner = () => {
	const t = useT();
	const [dismissed, setDismissed] = useState(() => {
		try {
			return sessionStorage.getItem(DISMISS_KEY) === "1";
		} catch {
			return false;
		}
	});
	const meQ = useQuery({
		meta: { silent: true },
		queryFn: fetchMe,
		queryKey: ["legacy", "me"],
		retry: false,
		staleTime: 300_000,
	});
	const resendMut = useMutation({
		mutationFn: resendVerification,
		// Errors are ignored on purpose: the banner stays, the user can retry.
		onError: () => {},
		onSuccess: () => toast.success(t("verify.resent")),
	});

	const user = meQ.data;
	if (dismissed || !user || user.email_verified !== false) return null;

	const dismiss = () => {
		setDismissed(true);
		try {
			sessionStorage.setItem(DISMISS_KEY, "1");
		} catch {
			/* ignore */
		}
	};

	return (
		<div
			className="bg-muted/60 text-foreground ring-foreground/10 mb-2.5 flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-2 text-xs ring-1"
			role="status"
		>
			<MailWarning className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
			<p className="min-w-0 flex-1">{t("verify.banner", { email: user.email })}</p>
			<Button
				size="xs"
				variant="outline"
				disabled={resendMut.isPending || resendMut.isSuccess}
				onClick={() => resendMut.mutate()}
			>
				{resendMut.isSuccess ? t("verify.resent") : t("verify.resend")}
			</Button>
			<button
				type="button"
				aria-label={t("billing.dismiss")}
				onClick={dismiss}
				className="hover:text-foreground focus-visible:outline-ring -mx-1 rounded-md p-1 opacity-70 transition-opacity outline-offset-2 hover:opacity-100 focus-visible:outline-2"
			>
				<X className="size-3.5" aria-hidden />
			</button>
		</div>
	);
};

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import { fetchMe, resendVerification } from "@/lib/legacy/api";

const DISMISS_KEY = "kp_verify_banner_dismissed";

export interface VerifyNotice {
	email: string;
	resend: () => void;
	resending: boolean;
	resent: boolean;
	dismiss: () => void;
}

/**
 * The verify-email line for the account notice bar (AccountNotices). Set
 * while /auth/me reports email_verified: false; a missing field (older
 * worker) counts as verified. Dismissal lasts for the browser session.
 */
export const useVerifyNotice = (): VerifyNotice | null => {
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
		// Errors are ignored on purpose: the notice stays, the user can retry.
		onError: () => {},
		onSuccess: () => toast.success(t("verify.resent")),
	});

	const user = meQ.data;
	if (dismissed || !user || user.email_verified !== false) return null;

	return {
		dismiss: () => {
			setDismissed(true);
			try {
				sessionStorage.setItem(DISMISS_KEY, "1");
			} catch {
				/* ignore */
			}
		},
		email: user.email,
		resend: () => resendMut.mutate(),
		resending: resendMut.isPending,
		resent: resendMut.isSuccess,
	};
};

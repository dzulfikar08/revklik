import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { AuthShell, authPrimaryLinkClass } from "@/components/auth-shell";
import { authDocumentTitle } from "@/lib/auth-page";
import { getLocale, useT } from "@/lib/i18n";
import { verifyEmail } from "@/lib/legacy/api";
import type { VerifyEmailResult } from "@/lib/legacy/api";

/** Target of the verification email: /verify-email?token=… */
export const Route = createFileRoute("/verify-email")({
	validateSearch: (search: Record<string, unknown>): { token?: string } =>
		typeof search.token === "string" && search.token ? { token: search.token } : {},
	component: VerifyEmail,
	head: () => ({ meta: [{ title: authDocumentTitle(getLocale(), "verify") }] }),
});

function VerifyEmail() {
	const t = useT();
	const { token } = Route.useSearch();
	const [result, setResult] = useState<VerifyEmailResult | null>(token ? null : "invalid_token");

	useEffect(() => {
		if (!token) return;
		let live = true;
		void verifyEmail(token).then((r) => {
			if (live) setResult(r);
		});
		return () => {
			live = false;
		};
	}, [token]);

	return (
		<AuthShell
			title={t("verify.title")}
			page="verify"
			description={
				<span role="status" aria-live="polite">
					{result === null ? t("verify.checking") : t(`verify.${result}`)}
				</span>
			}
		>
			{result === null ? (
				<LoaderCircle className="text-muted-foreground mx-auto size-5 animate-spin" aria-hidden />
			) : (
				<Link to="/analytics" className={authPrimaryLinkClass}>
					{t("verify.toDashboard")}
				</Link>
			)}
		</AuthShell>
	);
}

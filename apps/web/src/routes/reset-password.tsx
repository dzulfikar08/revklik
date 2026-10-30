import { Button } from "@revklik/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { AuthField } from "@/components/auth-field";
import {
	AuthShell,
	authLinkClass,
	authPrimaryClass,
	authPrimaryLinkClass,
} from "@/components/auth-shell";
import { authDocumentTitle, MIN_PASSWORD_LENGTH } from "@/lib/auth-page";
import { getLocale, useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { resetPassword } from "@/lib/legacy/api";

/** Target of the emailed reset link: /reset-password?token=… */
export const Route = createFileRoute("/reset-password")({
	validateSearch: (search: Record<string, unknown>): { token?: string } =>
		typeof search.token === "string" && search.token ? { token: search.token } : {},
	component: ResetPassword,
	head: () => ({ meta: [{ title: authDocumentTitle(getLocale(), "reset") }] }),
});

const linkClass = `justify-self-center text-[13px] ${authLinkClass}`;

function ResetPassword() {
	const t = useT();
	const { token } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [submitted, setSubmitted] = useState(false);
	// The kind, not translated text, so a language switch keeps the state.
	const [failed, setFailed] = useState(false);
	const [pending, setPending] = useState(false);
	const [done, setDone] = useState(false);

	if (!token) {
		return (
			<AuthShell title={t("reset.title")} description={t("reset.missingToken")} page="reset">
				<Link to="/login" className={linkClass}>
					{t("reset.requestNew")}
				</Link>
			</AuthShell>
		);
	}

	let passwordError: MessageKey | undefined;
	if (!password) {
		passwordError = "auth.err.passwordRequired";
	} else if (password.length < MIN_PASSWORD_LENGTH) {
		passwordError = "auth.err.passwordShort";
	}
	let confirmError: MessageKey | undefined;
	if (!confirm) {
		confirmError = "auth.err.passwordRequired";
	} else if (password !== confirm) {
		confirmError = "reset.mismatch";
	}

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (pending) return;
		setFailed(false);
		if (passwordError || confirmError) {
			setSubmitted(true);
			document.getElementById(passwordError ? "new-password" : "confirm-password")?.focus();
			return;
		}
		setPending(true);
		try {
			await resetPassword(token, password);
			setDone(true);
		} catch {
			setFailed(true);
		} finally {
			setPending(false);
		}
	};

	if (done) {
		return (
			<AuthShell title={t("reset.title")} description={t("reset.done")} page="reset">
				<Link to="/login" className={authPrimaryLinkClass}>
					{t("auth.signInBtn")}
				</Link>
			</AuthShell>
		);
	}

	return (
		<AuthShell title={t("reset.title")} description={t("reset.desc")} page="reset">
			<form onSubmit={submit} noValidate className="grid gap-3">
				<AuthField
					id="new-password"
					label={t("reset.new")}
					type="password"
					autoComplete="new-password"
					value={password}
					onChange={setPassword}
					error={submitted ? passwordError : undefined}
					autoFocus
				/>
				<AuthField
					id="confirm-password"
					label={t("reset.confirm")}
					type="password"
					autoComplete="new-password"
					value={confirm}
					onChange={setConfirm}
					error={submitted ? confirmError : undefined}
				/>
				{failed && (
					<p className="text-destructive text-sm" role="alert">
						{t("reset.failed")}
					</p>
				)}
				<Button type="submit" className={`mt-1 ${authPrimaryClass}`} disabled={pending}>
					{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
					{t("reset.submit")}
				</Button>
			</form>
			{failed ? (
				<Link to="/login" className={linkClass}>
					{t("reset.requestNew")}
				</Link>
			) : null}
		</AuthShell>
	);
}

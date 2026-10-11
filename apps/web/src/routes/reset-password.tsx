import { Button, buttonVariants } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { AuthShell } from "@/components/auth-form";
import { useT } from "@/lib/i18n";
import { resetPassword } from "@/lib/legacy/api";

/** Target of the emailed reset link: /reset-password?token=… */
export const Route = createFileRoute("/reset-password")({
	validateSearch: (search: Record<string, unknown>): { token?: string } =>
		typeof search.token === "string" && search.token ? { token: search.token } : {},
	component: ResetPassword,
	head: () => ({ meta: [{ title: "Reset password · RevKlik" }] }),
});

const MIN_PASSWORD = 8;

const linkClass =
	"justify-self-center text-sm text-foreground font-medium underline underline-offset-4 rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

function ResetPassword() {
	const t = useT();
	const { token } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [done, setDone] = useState(false);

	if (!token) {
		return (
			<AuthShell title={t("reset.title")} description={t("reset.missingToken")}>
				<Link to="/login" className={linkClass}>
					{t("reset.requestNew")}
				</Link>
			</AuthShell>
		);
	}

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (pending) return;
		if (password !== confirm) {
			setError(t("reset.mismatch"));
			return;
		}
		setError(null);
		setPending(true);
		try {
			await resetPassword(token, password);
			setDone(true);
		} catch {
			setError(t("reset.failed"));
		} finally {
			setPending(false);
		}
	};

	if (done) {
		return (
			<AuthShell title={t("reset.title")} description={t("reset.done")}>
				<Link to="/login" className={buttonVariants({ className: "w-full" })}>
					{t("auth.signInBtn")}
				</Link>
			</AuthShell>
		);
	}

	return (
		<AuthShell title={t("reset.title")} description={t("reset.desc")}>
			<form onSubmit={submit} className="grid gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="new-password">{t("reset.new")}</Label>
					<Input
						id="new-password"
						type="password"
						autoComplete="new-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={MIN_PASSWORD}
						autoFocus
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="confirm-password">{t("reset.confirm")}</Label>
					<Input
						id="confirm-password"
						type="password"
						autoComplete="new-password"
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						required
						minLength={MIN_PASSWORD}
					/>
				</div>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				<Button type="submit" className="w-full" disabled={pending}>
					{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />}
					{t("reset.submit")}
				</Button>
			</form>
			{error === t("reset.failed") ? (
				<Link to="/login" className={linkClass}>
					{t("reset.requestNew")}
				</Link>
			) : null}
		</AuthShell>
	);
}

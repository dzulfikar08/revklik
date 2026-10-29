import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { RememberedAccounts } from "@/components/remembered-accounts";
import { GoogleIcon } from "@/components/google-icon";
import { AuthShell, authButtonClass, authInputClass, authLinkClass } from "@/components/auth-shell";
import { useT } from "@/lib/i18n";
import {
	LEGACY_API_BASE,
	legacyLogin,
	legacyRegister,
	requestPasswordReset,
} from "@/lib/legacy/api";
import { authErrorMessage } from "@/lib/auth-errors";
import { afterAuthPath, googleAuthUrl } from "@/lib/auth-search";
import type { AuthSearch } from "@/lib/auth-search";
import { isSelfHosted } from "@/lib/instance-config";
import { planLabel } from "@/lib/legacy/billing";
import {
	clearSignupIntent,
	rememberRef,
	rememberSignupPlan,
	rememberVisitorId,
	signupRef,
	signupVisitorId,
} from "@/lib/signup-intent";
import { loadAuthTracker } from "@/lib/tracker";

export type AuthMode = "sign-in" | "sign-up";

const ForgotPasswordForm = ({ onBack }: { onBack: () => void }) => {
	const t = useT();
	const [email, setEmail] = useState("");
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (pending) return;
		setError(null);
		setPending(true);
		try {
			await requestPasswordReset(email.trim());
			setSentTo(email.trim());
		} catch {
			setError(t("forgot.error"));
		} finally {
			setPending(false);
		}
	};

	return (
		<AuthShell title={t("forgot.title")} description={t("forgot.desc")}>
			{sentTo ? (
				<p className="bg-muted/60 rounded-lg p-3 text-sm" role="status">
					{t("forgot.sent", { email: sentTo })}
				</p>
			) : (
				<form onSubmit={submit} className="grid gap-3">
					<div className="grid gap-1.5">
						<Label htmlFor="forgot-email">{t("auth.email")}</Label>
						<Input
							id="forgot-email"
							className={authInputClass}
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							autoFocus
						/>
					</div>
					{error && (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					)}
					<Button type="submit" className={authButtonClass} disabled={pending}>
						{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
						{t("forgot.submit")}
					</Button>
				</form>
			)}
			<button
				type="button"
				className={`justify-self-center text-sm ${authLinkClass}`}
				onClick={onBack}
			>
				{t("forgot.back")}
			</button>
		</AuthShell>
	);
};

/**
 * Email/password + Google auth. /login renders sign-in, /register sign-up;
 * both carry ?plan and ?ref so a visitor from the pricing page or an
 * affiliate link keeps that context whichever form they end up using.
 */
export const AuthForm = ({ mode, search }: { mode: AuthMode; search: AuthSearch }) => {
	const t = useT();
	const [forgot, setForgot] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const { plan, ref, rk_sid: rkSid, rk_vid: rkVid } = search;

	useEffect(() => {
		rememberRef(ref);
		rememberVisitorId(rkVid);
		loadAuthTracker({ sessionId: rkSid, visitorId: rkVid });
	}, [ref, rkVid, rkSid]);

	if (forgot) {
		return <ForgotPasswordForm onBack={() => setForgot(false)} />;
	}

	const signUp = mode === "sign-up";

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (pending) return;
		setError(null);
		setPending(true);
		try {
			if (signUp) {
				await legacyRegister(name.trim(), email.trim(), password, {
					plan,
					ref: signupRef(ref),
					visitorId: signupVisitorId(rkVid),
				});
				clearSignupIntent();
			} else {
				await legacyLogin(email.trim(), password);
			}
			// A document load, not a router navigation: the tracker running on this
			// page must not follow the user into the authenticated dashboard.
			window.location.assign(afterAuthPath(search));
		} catch (err) {
			setError(authErrorMessage(err, signUp, t));
		} finally {
			setPending(false);
		}
	};

	// Every signup starts on a Growth trial, so a picked Micro or Starter gets
	// one line saying so; plain sign-up and ?plan=growth share the trial line.
	let description = t("auth.signIn.desc");
	if (signUp) {
		if (isSelfHosted()) {
			description = t("auth.signUp.descSelfHosted");
		} else if (plan && plan !== "growth") {
			description = t("auth.signUp.descPlan", { plan: planLabel(plan) });
		} else {
			description = t("auth.signUp.desc");
		}
	}

	const continueWithGoogle = () => {
		// The Google callback lands on /#token=…; the plan rides along in storage.
		rememberSignupPlan(plan);
		// The worker carries ?ref through the OAuth state to the new account.
		window.location.href = googleAuthUrl(
			LEGACY_API_BASE,
			signupRef(ref),
			plan,
			signupVisitorId(rkVid),
		);
	};

	return (
		<AuthShell
			title={signUp ? t("auth.signUp.title") : t("auth.signIn.title")}
			description={description}
		>
			{signUp ? null : (
				<RememberedAccounts onContinue={() => window.location.assign(afterAuthPath(search))} />
			)}
			<form onSubmit={submit} className="grid gap-3">
				{signUp && (
					<div className="grid gap-1.5">
						<Label htmlFor="name">{t("auth.name")}</Label>
						<Input
							id="name"
							className={authInputClass}
							autoComplete="name"
							placeholder={t("auth.namePlaceholder")}
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>
				)}
				<div className="grid gap-1.5">
					<Label htmlFor="email">{t("auth.email")}</Label>
					<Input
						id="email"
						className={authInputClass}
						type="email"
						autoComplete="email"
						placeholder="you@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</div>
				<div className="grid gap-1.5">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="password">{t("auth.password")}</Label>
						{signUp ? null : (
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground focus-visible:outline-ring pointer-coarse:min-h-10 rounded-sm text-xs outline-offset-2 transition-colors duration-150 focus-visible:outline-2"
								onClick={() => {
									setError(null);
									setForgot(true);
								}}
							>
								{t("auth.forgot")}
							</button>
						)}
					</div>
					<Input
						id="password"
						className={authInputClass}
						type="password"
						autoComplete={signUp ? "new-password" : "current-password"}
						placeholder="••••••••"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
					/>
				</div>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				<Button type="submit" className={`mt-1 ${authButtonClass}`} disabled={pending}>
					{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
					{signUp ? t("auth.signUpBtn") : t("auth.signInBtn")}
				</Button>
			</form>

			<div className="flex items-center gap-3" role="separator" aria-label={t("auth.or")}>
				<span className="bg-border h-px flex-1" aria-hidden />
				<span className="text-muted-foreground text-xs" aria-hidden>
					{t("auth.or")}
				</span>
				<span className="bg-border h-px flex-1" aria-hidden />
			</div>

			<Button
				type="button"
				variant="outline"
				className={`${authButtonClass} gap-2`}
				onClick={continueWithGoogle}
			>
				<GoogleIcon />
				{t("auth.google")}
			</Button>

			<p className="text-muted-foreground mt-1 text-center text-[13px]">
				{signUp ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
				<Link to={signUp ? "/login" : "/register"} search={search} className={authLinkClass}>
					{signUp ? t("auth.signInLink") : t("auth.createOne")}
				</Link>
			</p>
		</AuthShell>
	);
};

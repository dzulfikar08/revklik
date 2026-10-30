import { Button } from "@revklik/ui/components/button";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { AuthField } from "@/components/auth-field";
import { GoogleIcon } from "@/components/google-icon";
import { RememberedAccounts } from "@/components/remembered-accounts";
import {
	AuthShell,
	authButtonClass,
	authLinkClass,
	authPrimaryClass,
} from "@/components/auth-shell";
import { SignupConsent, TrialValuePanel } from "@/components/auth-signup-extras";
import { authErrorMessage } from "@/lib/auth-errors";
import { firstInvalidField, validateAuthFields } from "@/lib/auth-page";
import { afterAuthPath, googleAuthUrl } from "@/lib/auth-search";
import type { AuthSearch } from "@/lib/auth-search";
import { useLocale, useT } from "@/lib/i18n";
import { isSelfHosted } from "@/lib/instance-config";
import {
	LEGACY_API_BASE,
	legacyLogin,
	legacyRegister,
	requestPasswordReset,
} from "@/lib/legacy/api";
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
	const [submitted, setSubmitted] = useState(false);
	const [pending, setPending] = useState(false);

	// Only the email is checked here; the dummy password keeps that rule out of play.
	const emailProblem = validateAuthFields({ email, name: "", password: "x" }, false).email;
	const emailError = submitted ? emailProblem : undefined;

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (pending) return;
		setError(null);
		if (emailProblem) {
			setSubmitted(true);
			document.getElementById("forgot-email")?.focus();
			return;
		}
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
		<AuthShell title={t("forgot.title")} description={t("forgot.desc")} page="reset">
			{sentTo ? (
				<p className="bg-muted/60 rounded-lg p-3 text-sm" role="status">
					{t("forgot.sent", { email: sentTo })}
				</p>
			) : (
				<form onSubmit={submit} noValidate className="grid gap-3">
					<AuthField
						id="forgot-email"
						label={t("auth.email")}
						type="email"
						autoComplete="email"
						placeholder={t("auth.emailPlaceholder")}
						value={email}
						onChange={setEmail}
						error={emailError}
						autoFocus
					/>
					{error && (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					)}
					<Button type="submit" className={authPrimaryClass} disabled={pending}>
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

const OrDivider = ({ label }: { label: string }) => (
	<div className="flex items-center gap-3" role="separator" aria-label={label}>
		<span className="bg-border h-px flex-1" aria-hidden />
		<span className="text-muted-foreground text-xs" aria-hidden>
			{label}
		</span>
		<span className="bg-border h-px flex-1" aria-hidden />
	</div>
);

const GoogleButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
	<Button type="button" variant="outline" className={`${authButtonClass} gap-2`} onClick={onClick}>
		<GoogleIcon />
		{label}
	</Button>
);

/**
 * Email/password + Google auth. /login renders sign-in, /register sign-up;
 * both carry ?plan and ?ref so a visitor from the pricing page or an
 * affiliate link keeps that context whichever form they end up using.
 * Sign-up leads with Google (one click for a solo founder), then the email
 * form; sign-in leads with the form. Both validate in place, in the page's
 * language, and focus the first field that needs fixing.
 */
export const AuthForm = ({ mode, search }: { mode: AuthMode; search: AuthSearch }) => {
	const t = useT();
	const locale = useLocale();
	const [forgot, setForgot] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitted, setSubmitted] = useState(false);
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
	const hosted = !isSelfHosted();
	// Errors appear after the first submit, then follow the input as it is fixed.
	const fieldErrors = submitted ? validateAuthFields({ email, name, password }, signUp) : {};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (pending) return;
		setError(null);
		const firstInvalid = firstInvalidField(validateAuthFields({ email, name, password }, signUp));
		if (firstInvalid) {
			setSubmitted(true);
			document.getElementById(firstInvalid)?.focus();
			return;
		}
		setPending(true);
		try {
			if (signUp) {
				await legacyRegister(name.trim(), email.trim(), password, {
					acceptedTerms: hosted,
					lang: locale,
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
			page={signUp ? "signUp" : "signIn"}
			aside={signUp && hosted ? <TrialValuePanel /> : undefined}
		>
			{signUp ? null : (
				<RememberedAccounts onContinue={() => window.location.assign(afterAuthPath(search))} />
			)}
			{signUp ? (
				<>
					<GoogleButton label={t("auth.google")} onClick={continueWithGoogle} />
					<OrDivider label={t("auth.orEmail")} />
				</>
			) : null}
			<form onSubmit={submit} noValidate className="grid gap-3">
				{signUp && (
					<AuthField
						id="name"
						label={t("auth.name")}
						autoComplete="name"
						placeholder={t("auth.namePlaceholder")}
						value={name}
						onChange={setName}
						error={fieldErrors.name}
					/>
				)}
				<AuthField
					id="email"
					label={t("auth.email")}
					type="email"
					autoComplete="email"
					placeholder={t("auth.emailPlaceholder")}
					value={email}
					onChange={setEmail}
					error={fieldErrors.email}
				/>
				<AuthField
					id="password"
					label={t("auth.password")}
					type="password"
					autoComplete={signUp ? "new-password" : "current-password"}
					value={password}
					onChange={setPassword}
					error={fieldErrors.password}
					hint={signUp ? t("auth.passwordHint") : undefined}
					labelAside={
						signUp ? null : (
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground focus-visible:outline-ring pointer-coarse:min-h-11 rounded-sm text-xs outline-offset-2 transition-colors duration-150 focus-visible:outline-2"
								onClick={() => {
									setError(null);
									setForgot(true);
								}}
							>
								{t("auth.forgot")}
							</button>
						)
					}
				/>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				<Button type="submit" className={`mt-1 ${authPrimaryClass}`} disabled={pending}>
					{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
					{signUp ? t("auth.signUpBtn") : t("auth.signInBtn")}
				</Button>
				{signUp && hosted ? <SignupConsent /> : null}
			</form>

			{signUp ? null : (
				<>
					<OrDivider label={t("auth.or")} />
					<GoogleButton label={t("auth.google")} onClick={continueWithGoogle} />
				</>
			)}

			<p className="text-muted-foreground mt-1 text-center text-[13px]">
				{signUp ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
				<Link to={signUp ? "/login" : "/register"} search={search} className={authLinkClass}>
					{signUp ? t("auth.signInLink") : t("auth.createOne")}
				</Link>
			</p>
		</AuthShell>
	);
};

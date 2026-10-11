import { Button } from "@revklik/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@revklik/ui/components/card";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { Link, useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { LocaleToggle } from "@/components/locale-toggle";
import { useT } from "@/lib/i18n";
import {
	LEGACY_API_BASE,
	LegacyApiError,
	legacyLogin,
	legacyRegister,
	requestPasswordReset,
} from "@/lib/legacy/api";
import { parsePlan, planLabel } from "@/lib/legacy/billing";
import type { PlanTier } from "@/lib/legacy/billing";
import { clearSignupIntent, rememberRef, rememberSignupPlan, storedRef } from "@/lib/signup-intent";

export type AuthMode = "sign-in" | "sign-up";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

export interface AuthSearch {
	plan?: PlanTier;
	ref?: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
}

/** Keep a known plan, a string ref and UTM tags (for attribution); drop the rest. */
export const validateAuthSearch = (search: Record<string, unknown>): AuthSearch => {
	const out: AuthSearch = {};
	const plan = parsePlan(search.plan);
	if (plan) out.plan = plan;
	if (typeof search.ref === "string" && search.ref) out.ref = search.ref;
	for (const key of UTM_KEYS) {
		const value = search[key];
		if (typeof value === "string" && value) out[key] = value;
	}
	return out;
};

function GoogleIcon() {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"
				fill="#EA4335"
			/>
		</svg>
	);
}

/** Centered card shell shared by sign-in, sign-up, forgot and reset. */
export const AuthShell = ({
	title,
	description,
	children,
}: {
	title: string;
	description: ReactNode;
	children: ReactNode;
}) => (
	<main className="bg-background relative grid min-h-svh place-items-center px-4 py-12">
		<LocaleToggle className="absolute top-3 right-3" />
		<Card className="border-border/60 w-full max-w-sm shadow-lg">
			<CardHeader className="items-center text-center">
				<img src="/revklik.webp" alt="RevKlik" className="mx-auto mb-1 h-12 w-12 rounded-xl" />
				<CardTitle className="text-xl">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">{children}</CardContent>
		</Card>
	</main>
);

const linkClass =
	"text-foreground font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring rounded-sm";

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
					<Button type="submit" className="w-full" disabled={pending}>
						{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />}
						{t("forgot.submit")}
					</Button>
				</form>
			)}
			<button type="button" className={`justify-self-center text-sm ${linkClass}`} onClick={onBack}>
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
	const navigate = useNavigate();
	const [forgot, setForgot] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const { plan, ref } = search;

	useEffect(() => {
		rememberRef(ref);
	}, [ref]);

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
					ref: ref ?? storedRef(),
				});
				clearSignupIntent();
			} else {
				await legacyLogin(email.trim(), password);
			}
			if (plan) {
				await navigate({ search: { plan }, to: "/analytics/billing" });
			} else {
				await navigate({ to: "/analytics" });
			}
		} catch (err) {
			const fallback = signUp ? t("auth.signUpError") : t("auth.error");
			setError(err instanceof LegacyApiError && err.status !== 500 ? err.message : fallback);
		} finally {
			setPending(false);
		}
	};

	const continueWithGoogle = () => {
		// The Google callback lands on /#token=…; the plan rides along in storage.
		rememberSignupPlan(plan);
		window.location.href = `${LEGACY_API_BASE}/auth/google`;
	};

	return (
		<AuthShell
			title={signUp ? t("auth.signUp.title") : t("auth.signIn.title")}
			description={
				<>
					{signUp ? t("auth.signUp.desc") : t("auth.signIn.desc")}
					{plan ? (
						<span className="mt-1 block">
							{t("auth.signUp.planNote", { plan: planLabel(plan) })}
						</span>
					) : null}
				</>
			}
		>
			<form onSubmit={submit} className="grid gap-3">
				{signUp && (
					<div className="grid gap-1.5">
						<Label htmlFor="name">{t("auth.name")}</Label>
						<Input
							id="name"
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
								className={`text-muted-foreground hover:text-foreground text-xs ${linkClass} font-normal`}
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
				<Button type="submit" className="w-full" disabled={pending}>
					{pending && <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />}
					{signUp ? t("auth.signUpBtn") : t("auth.signInBtn")}
				</Button>
			</form>

			<div className="flex items-center gap-3">
				<span className="bg-border h-px flex-1" />
				<span className="text-muted-foreground text-xs">{t("auth.or")}</span>
				<span className="bg-border h-px flex-1" />
			</div>

			<Button type="button" variant="outline" className="w-full" onClick={continueWithGoogle}>
				<GoogleIcon />
				{t("auth.google")}
			</Button>

			<p className="text-muted-foreground text-center text-sm">
				{signUp ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
				<Link to={signUp ? "/login" : "/register"} search={search} className={linkClass}>
					{signUp ? t("auth.signInLink") : t("auth.createOne")}
				</Link>
			</p>
		</AuthShell>
	);
};

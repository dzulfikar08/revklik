import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "@/components/toast";
import { isLoggedIn, register } from "@/lib/api";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/register")({
	component: RegisterPage,
	validateSearch: (search: Record<string, string>): { ref?: string; plan?: string } => ({
		ref: search.ref || undefined,
		// ?plan=micro|starter|growth — set by the landing pricing CTAs;
		// after signup we drop the user straight into the paywall.
		plan: search.plan || undefined,
	}),
});

function RegisterPage() {
	const navigate = useNavigate();
	const { ref, plan } = Route.useSearch();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");

	useEffect(() => {
		if (isLoggedIn()) {
			const timer = setTimeout(() => navigate({ to: plan ? "/paywall" : "/" }), 0);
			return () => clearTimeout(timer);
		}
	}, [navigate, plan]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		try {
			await register({ name, email, password }, ref);
			navigate({ to: plan ? "/paywall" : "/" });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Registration failed";
			setError(msg);
			toast(msg, "error");
		}
	};

	const apiBase =
		import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");
	const googleAuthUrl = `${apiBase}/auth/google`;

	return (
		<div
			style={{
				height: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--bg)",
				padding: "0 20px",
			}}
		>
			<div style={{ width: "100%", maxWidth: 380 }}>
				<div style={{ textAlign: "center", marginBottom: 36 }}>
					<img
						src="/revklik.webp"
						alt="RevKlik"
						width={48}
						height={48}
						style={{ borderRadius: 12, marginBottom: 20 }}
					/>
					<h1
						style={{
							fontFamily: "var(--sans)",

							fontWeight: 600,
							fontSize: 28,
							color: "var(--text)",
							marginBottom: 6,
						}}
					>
						{t("auth.create_account")}
					</h1>
					<p style={{ fontSize: 14, color: "var(--text3)" }}>{t("auth.register_subtitle")}</p>
				</div>

				<a
					href={googleAuthUrl}
					style={{
						width: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: 10,
						padding: "12px 20px",
						background: "#fff",
						color: "#1f1f1f",
						borderRadius: 10,
						fontSize: 14,
						fontWeight: 500,
						textDecoration: "none",
						border: "1px solid var(--border)",
						marginBottom: 16,
					}}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
						<path
							fill="#4285F4"
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
						/>
						<path
							fill="#34A853"
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						/>
						<path
							fill="#FBBC05"
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						/>
						<path
							fill="#EA4335"
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						/>
					</svg>
					Continue with Google
				</a>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						marginBottom: 16,
					}}
				>
					<div style={{ flex: 1, height: 1, background: "var(--border)" }} />
					<span
						style={{
							fontSize: 11,
							color: "var(--text3)",
							textTransform: "uppercase",
							letterSpacing: "0.06em",
						}}
					>
						or
					</span>
					<div style={{ flex: 1, height: 1, background: "var(--border)" }} />
				</div>

				<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					{error && (
						<div
							style={{
								fontSize: 13,
								color: "var(--crit)",
								background: "var(--crit-dim)",
								borderRadius: 8,
								padding: "10px 14px",
							}}
						>
							{error}
						</div>
					)}
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<label
							htmlFor="name"
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								fontWeight: 600,
								color: "var(--text3)",
								textTransform: "uppercase",
								letterSpacing: "0.08em",
							}}
						>
							{t("auth.name")}
						</label>
						<input
							id="name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							placeholder="Your name"
							style={{ width: "100%", padding: "12px 16px", fontSize: 14 }}
						/>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<label
							htmlFor="email"
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								fontWeight: 600,
								color: "var(--text3)",
								textTransform: "uppercase",
								letterSpacing: "0.08em",
							}}
						>
							{t("auth.email")}
						</label>
						<input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							placeholder="you@company.com"
							style={{ width: "100%", padding: "12px 16px", fontSize: 14 }}
						/>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<label
							htmlFor="password"
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								fontWeight: 600,
								color: "var(--text3)",
								textTransform: "uppercase",
								letterSpacing: "0.08em",
							}}
						>
							{t("auth.password")}
						</label>
						<input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={8}
							placeholder="Min. 8 characters"
							style={{ width: "100%", padding: "12px 16px", fontSize: 14 }}
						/>
					</div>
					<button
						type="submit"
						className="btn-accent"
						style={{
							width: "100%",
							padding: "12px 24px",
							fontSize: 14,
							justifyContent: "center",
						}}
					>
						{t("auth.create_account")}
					</button>
				</form>

				<p
					style={{
						textAlign: "center",
						fontSize: 13,
						color: "var(--text3)",
						marginTop: 24,
					}}
				>
					{t("auth.has_account")}{" "}
					<a
						href="/login"
						style={{
							color: "var(--accent)",
							textDecoration: "none",
							fontWeight: 500,
						}}
					>
						{t("auth.signin_link")}
					</a>
				</p>
			</div>
		</div>
	);
}

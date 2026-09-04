import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@revklik-new/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@revklik-new/ui/components/card";
import { Input } from "@revklik-new/ui/components/input";
import { Label } from "@revklik-new/ui/components/label";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import {
  LEGACY_API_BASE,
  LegacyApiError,
  legacyLogin,
  legacyRegister,
} from "@/lib/legacy/api";

type Mode = "sign-in" | "sign-up";

export const Route = createFileRoute("/login")({
  component: Login,
});

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

function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      if (mode === "sign-in") {
        await legacyLogin(email.trim(), password);
      } else {
        await legacyRegister(name.trim(), email.trim(), password);
      }
      await navigate({ to: "/analytics" });
    } catch (err) {
      setError(
        err instanceof LegacyApiError
          ? err.message
          : "Couldn't sign you in — please try again"
      );
    } finally {
      setPending(false);
    }
  };

  const signInWithGoogle = () => {
    window.location.href = `${LEGACY_API_BASE}/auth/google`;
  };

  return (
    <main className="grid min-h-svh place-items-center bg-background px-4">
      <Card className="w-full max-w-sm border-border/60 shadow-lg">
        <CardHeader className="items-center text-center">
          <img
            src="/revklik.webp"
            alt=""
            className="mx-auto mb-1 h-12 w-12 rounded-xl"
          />
          <CardTitle className="text-xl">
            {mode === "sign-in" ? "Welcome back" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {mode === "sign-in"
              ? "Sign in to your revklik analytics"
              : "Start your free 7-day trial — no card required"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={submit} className="grid gap-3">
            {mode === "sign-up" && (
              <div className="grid gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
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
              {pending && (
                <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
              )}
              {mode === "sign-in" ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <span className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-xs">or</span>
            <span className="bg-border h-px flex-1" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={signInWithGoogle}
          >
            <GoogleIcon />
            Continue with Google
          </Button>

          <p className="text-muted-foreground text-center text-sm">
            {mode === "sign-in" ? (
              <>
                No account?{" "}
                <button
                  type="button"
                  className="text-foreground font-medium underline underline-offset-4"
                  onClick={() => {
                    setMode("sign-up");
                    setError(null);
                  }}
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="text-foreground font-medium underline underline-offset-4"
                  onClick={() => {
                    setMode("sign-in");
                    setError(null);
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

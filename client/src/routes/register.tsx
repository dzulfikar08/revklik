import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { register } from "@/lib/api";

export const Route = createFileRoute("/register")({ component: RegisterPage });

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await register({ name, email, password });
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  };

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: "var(--accent)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, fontSize: 26, color: "#0a0a0a", marginBottom: 20,
          }}>k</div>
          <h1 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, fontSize: 28, color: "var(--text)", marginBottom: 6 }}>Create account</h1>
          <p style={{ fontSize: 14, color: "var(--text3)" }}>Start tracking your sites in minutes</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ fontSize: 13, color: "var(--crit)", background: "var(--crit-dim)", borderRadius: 8, padding: "10px 14px" }}>{error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Name</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" style={{ width: "100%", padding: "12px 16px", fontSize: 14 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" style={{ width: "100%", padding: "12px 16px", fontSize: 14 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="Min. 8 characters" style={{ width: "100%", padding: "12px 16px", fontSize: 14 }} />
          </div>
          <button type="submit" className="btn-accent" style={{ width: "100%", padding: "12px 24px", fontSize: 14, justifyContent: "center" }}>Create account</button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--text3)", marginTop: 24 }}>
          Already have an account? <a href="/login" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}

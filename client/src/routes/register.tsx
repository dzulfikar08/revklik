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
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, color: "#fff", marginBottom: 16 }}>K</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--fg)", marginBottom: 4 }}>Create account</h1>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>Start tracking your sites in minutes</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ fontSize: 13, color: "var(--crit)", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "10px 14px" }}>{error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Name</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" style={{ width: "100%", padding: "10px 14px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" style={{ width: "100%", padding: "10px 14px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="Min. 8 characters" style={{ width: "100%", padding: "10px 14px", fontSize: 13 }} />
          </div>
          <button type="submit" style={{ width: "100%", padding: "10px 18px", borderRadius: 6, border: "none", background: "var(--cyan)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Create account</button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 24 }}>
          Already have an account? <a href="/login" style={{ color: "var(--cyan)", textDecoration: "none", fontWeight: 500 }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPlans, fetchSubscription, createCheckout, logout } from "@/lib/api";
import type { PlanInfo } from "shared";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";

export const Route = createFileRoute("/paywall")({ component: PaywallPage });

const PLAN_META: Record<string, { label: string; popular?: boolean }> = {
  micro: { label: "Micro" },
  starter: { label: "Starter", popular: true },
  growth: { label: "Growth" },
};

function PaywallPage() {
  const qc = useQueryClient();

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  const { data: plans, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: fetchPlans,
  });

  const checkoutMut = useMutation({
    mutationFn: (tier: string) => createCheckout(tier),
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (err) => toast(err.message, "error"),
  });

  if (isLoading) return <div className="spinner" />;

  const currentPlan = subscription?.plan;
  const isActive = subscription?.status === "active" || subscription?.status === "trialing";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="overview-scroll">
        <PageHeader title="Choose a Plan" subtitle="Select a plan to get started with RevKlik" />

        <div className="paywall-container">
          <div className="paywall-cards">
            {(plans as PlanInfo[] | undefined)?.map((plan) => {
              const meta = PLAN_META[plan.tier] || { label: plan.name };
              const isCurrent = currentPlan === plan.tier && isActive;

              return (
                <div key={plan.tier} style={{
                  background: "var(--bg2)",
                  border: `1px solid ${isCurrent ? "var(--accent)" : meta.popular ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 12,
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                }}>
                  {meta.popular && (
                    <div style={{
                      position: "absolute", top: -10, right: 16,
                      background: "var(--accent)", color: "#fff",
                      fontFamily: "var(--mono)", fontSize: 9, fontWeight: 600,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      padding: "3px 10px", borderRadius: 100,
                    }}>
                      Popular
                    </div>
                  )}

                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    {meta.label}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 16 }}>
                    <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 36, color: "var(--text)" }}>${plan.price}</span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>/mo</span>
                  </div>

                  <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1, marginBottom: 20 }}>
                    {plan.features.map((f) => (
                      <li key={f} style={{ fontSize: 12, color: "var(--text2)", padding: "4px 0", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ color: "var(--accent)", fontSize: 10 }}>&#10003;</span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <button disabled style={{
                      width: "100%", padding: "10px 20px", borderRadius: 8,
                      background: "var(--bg3, var(--bg))", color: "var(--text3)",
                      border: "1px solid var(--border)", fontSize: 13, fontWeight: 500,
                      cursor: "default",
                    }}>
                      Current Plan
                    </button>
                  ) : (
                    <button
                      className={meta.popular ? "btn-accent" : ""}
                      onClick={() => checkoutMut.mutate(plan.tier)}
                      disabled={checkoutMut.isPending}
                      style={!meta.popular ? {
                        width: "100%", padding: "10px 20px", borderRadius: 8,
                        background: "transparent", color: "var(--text)",
                        border: "1px solid var(--border)", fontSize: 13, fontWeight: 500,
                        cursor: "pointer", justifyContent: "center",
                      } : { width: "100%", justifyContent: "center" }}
                    >
                      {checkoutMut.isPending ? "Redirecting..." : currentPlan ? "Upgrade" : "Get Started"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <button
              className="btn-pill"
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => { logout(); qc.clear(); window.location.href = "/login"; }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

use sqlx::PgPool;

/// Ordered plan tiers (micro, starter, growth) — for /billing/plans.
pub const PLANS_ORDERED: &[&str] = &["micro", "starter", "growth"];

/// Plan definitions (lib/plans.ts).
pub struct PlanDef {
    pub name: &'static str,
    pub events_per_month: i64,
    pub sites: i64,
    pub tier: i64,
}

pub fn plan_def(plan: &str) -> PlanDef {
    match plan {
        "starter" => PlanDef { name: "Starter", events_per_month: 100_000, sites: 3, tier: 1 },
        "growth" => PlanDef { name: "Growth", events_per_month: 500_000, sites: 10, tier: 2 },
        _ => PlanDef { name: "Micro", events_per_month: 10_000, sites: 1, tier: 0 }, // micro + free
    }
}

pub fn has_premium_features(plan: &str) -> bool {
    plan_def(plan).tier >= 2
}

pub fn api_rate_limit(plan: &str) -> u32 {
    match plan {
        "starter" => 120,
        "growth" => 300,
        _ => 30,
    }
}

pub fn plan_tier(plan: &str) -> i64 {
    plan_def(plan).tier
}

/// Monthly price in USD (lib/plans.ts).
pub fn plan_price(plan: &str) -> i64 {
    match plan {
        "starter" => 4,
        "growth" => 12,
        _ => 1, // micro
    }
}

/// Feature list for a plan tier (lib/plans.ts getFeatures).
pub fn plan_features(plan: &str) -> Vec<&'static str> {
    let base = vec![
        "Privacy-first analytics",
        "Cookieless tracking",
        "Visitor profiles",
        "UTM tracking",
        "CSV export",
    ];
    let mut f = base;
    match plan_def(plan).tier {
        0 => {
            f.push("1 site");
            f.push("10K events/month");
            f.push("<1KB script");
            f.push("7-day retention");
        }
        1 => {
            for x in ["3 sites", "100K events/month", "<1KB script", "30-day retention", "Funnel conversion", "Revenue attribution", "Real-time dashboard"] {
                f.push(x);
            }
        }
        _ => {
            for x in [
                "10 sites",
                "500K events/month",
                "Full script",
                "90-day retention",
                "AI insights",
                "Heatmaps",
                "Session replays",
                "Integrations",
                "Priority support",
                "Team members",
            ] {
                f.push(x);
            }
        }
    }
    f
}

/// Resolve the effective plan for a user, honoring active/trialing status + expiry.
/// Returns ("growth", true) for super_admin.
pub async fn effective_plan(db: &PgPool, user_id: &str) -> (String, bool) {
    let role: Option<(String,)> = sqlx::query_as("SELECT role FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten();
    if role.map(|(r,)| r == "super_admin").unwrap_or(false) {
        return ("growth".into(), true);
    }
    let row: Option<(String, String, Option<chrono::DateTime<chrono::Utc>>)> =
        sqlx::query_as("SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
    match row {
        Some((plan, status, end)) => {
            let active = (status == "active" || status == "trialing")
                && end.map(|e| e >= chrono::Utc::now()).unwrap_or(true);
            if active {
                (plan, false)
            } else {
                ("micro".into(), false)
            }
        }
        None => ("micro".into(), false),
    }
}

/// Token limits per plan (routes/tokens.ts). i64::MAX == unlimited.
pub fn token_limit(plan: &str) -> i64 {
    match plan {
        "growth" => i64::MAX,
        "starter" => 5,
        _ => 2, // free / micro
    }
}

/// Require a minimum plan tier for a feature. (lib/plans.ts requirePlan)
pub async fn require_plan(db: &PgPool, user_id: &str, required_tier: i64) -> (bool, String) {
    let (plan, _super) = effective_plan(db, user_id).await;
    let allowed = plan_tier(&plan) >= required_tier;
    (allowed, plan)
}

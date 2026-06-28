use crate::error::{AppError, AppResult};

/// Dimensions allowed in dynamic filters (analytics-queries.ts VALID_DIMENSIONS).
pub const VALID_DIMENSIONS: &[&str] = &[
    "path",
    "country",
    "region",
    "city",
    "device_type",
    "browser",
    "os",
    "referrer",
    "utm_source",
    "utm_medium",
    "utm_campaign",
];

#[derive(Debug, Clone)]
pub struct ParsedFilter {
    pub dimension: String,
    pub operator: String,
    pub value: String,
}

/// Parse "filters=country:is:ID,device_type:is_not:Mobile".
pub fn parse_filters(query: Option<&str>) -> Vec<ParsedFilter> {
    let Some(query) = query else { return vec![] };
    query
        .split(',')
        .filter_map(|f| {
            let mut parts = f.splitn(3, ':');
            let dimension = parts.next()?.to_string();
            let operator = parts.next().unwrap_or("is").to_string();
            let value = parts.next().unwrap_or("").to_string();
            if dimension.is_empty() || (value.is_empty() && operator != "exists" && operator != "not_exists") {
                return None;
            }
            if !VALID_DIMENSIONS.contains(&dimension.as_str()) {
                return None;
            }
            Some(ParsedFilter { dimension, operator, value })
        })
        .collect()
}

/// Render filters as SQL fragments with ABSOLUTE placeholder indices starting at `start_idx`.
/// Returns (parts: Vec<String>, binds: Vec<String>) in matching order.
/// Each part is like "col = $3" with the bind at the same position.
pub fn filter_parts(filters: &[ParsedFilter], start_idx: usize) -> (Vec<String>, Vec<String>) {
    let mut parts = Vec::new();
    let mut binds = Vec::new();
    let mut idx = start_idx;
    for f in filters {
        let col = f.dimension.clone();
        match f.operator.as_str() {
            "is" => {
                parts.push(format!("{col} = ${idx}"));
                binds.push(f.value.clone());
                idx += 1;
            }
            "is_not" => {
                parts.push(format!("({col} IS NULL OR {col} <> ${idx})"));
                binds.push(f.value.clone());
                idx += 1;
            }
            "contains" => {
                parts.push(format!("{col}::text ILIKE ${idx}"));
                binds.push(format!("%{}%", f.value));
                idx += 1;
            }
            "not_contains" => {
                parts.push(format!("({col} IS NULL OR {col}::text NOT ILIKE ${idx})"));
                binds.push(format!("%{}%", f.value));
                idx += 1;
            }
            "starts_with" => {
                parts.push(format!("{col}::text ILIKE ${idx}"));
                binds.push(format!("{}%", f.value));
                idx += 1;
            }
            "exists" => parts.push(format!("({col} IS NOT NULL AND {col} <> '')")),
            "not_exists" => parts.push(format!("({col} IS NULL OR {col} = '')")),
            _ => {}
        }
    }
    (parts, binds)
}

/// Legacy single-fragment form (relative $1..). Kept for compatibility.
pub fn filter_sql(filters: &[ParsedFilter]) -> (String, Vec<String>) {
    let (parts, binds) = filter_parts(filters, 1);
    (parts.join(" AND "), binds)
}

/// CSV escape (analytics-queries.ts toCsv).
pub fn to_csv(rows: &[serde_json::Value], columns: &[&str]) -> String {
    let esc = |v: &serde_json::Value| -> String {
        let s = match v {
            serde_json::Value::Null => String::new(),
            _ => v.to_string().trim_matches('"').to_string(),
        };
        if s.contains(',') || s.contains('"') || s.contains('\n') {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s
        }
    };
    let mut out = String::from(columns.join(","));
    for r in rows {
        out.push('\n');
        let cols: Vec<String> = columns.iter().map(|c| esc(&r.get(*c).cloned().unwrap_or(serde_json::Value::Null))).collect();
        out.push_str(&cols.join(","));
    }
    out
}

/// Resolve a range param ("7d","24h","30d","90d","start,end") to start DateTime.
pub fn range_start(range: Option<&str>) -> chrono::DateTime<chrono::Utc> {
    use chrono::Utc;
    let r = range.unwrap_or("7d");
    if r.contains(',') {
        if let Some(s) = r.split(',').next() {
            if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
                return d.with_timezone(&Utc);
            }
            if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
                return d.and_hms_opt(0, 0, 0).unwrap().and_local_timezone(Utc).single().unwrap_or_else(Utc::now);
            }
        }
    }
    let days: i64 = match r {
        "24h" => 1,
        "7d" => 7,
        "30d" => 30,
        "90d" => 90,
        _ => 7,
    };
    Utc::now() - chrono::Duration::days(days)
}

/// Require site access (dashboard routes use Auth; v1 uses PublicAuth→Auth). Returns Ok if allowed.
pub async fn validate_site_access(
    db: &sqlx::PgPool,
    auth: &crate::middleware::auth::Auth,
    site_id: &str,
) -> AppResult<()> {
    crate::middleware::site_access::require(db, auth, site_id).await
}

#[allow(dead_code)]
pub fn _unused(_e: AppError) {}

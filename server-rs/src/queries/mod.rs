pub mod analytics;
pub mod filters;

use sqlx::Row;

/// Fetch an Option<String> column from a Postgres row by index (nullable text col).
pub fn row_str(row: &sqlx::postgres::PgRow, idx: usize) -> Option<String> {
    row.try_get::<Option<String>, usize>(idx).ok().flatten()
}
pub fn row_i64(row: &sqlx::postgres::PgRow, idx: usize) -> i64 {
    row.try_get::<i64, usize>(idx).ok().or_else(|| row.try_get::<i32, usize>(idx).ok().map(|x| x as i64)).unwrap_or(0)
}
pub fn row_f64(row: &sqlx::postgres::PgRow, idx: usize) -> f64 {
    row.try_get::<f64, usize>(idx).ok().or_else(|| row.try_get::<i64, usize>(idx).ok().map(|x| x as f64)).unwrap_or(0.0)
}
pub fn row_bool(row: &sqlx::postgres::PgRow, idx: usize) -> bool {
    row.try_get::<bool, usize>(idx).unwrap_or(false)
}
pub fn row_dt(row: &sqlx::postgres::PgRow, idx: usize) -> chrono::DateTime<chrono::Utc> {
    row.try_get::<chrono::DateTime<chrono::Utc>, usize>(idx).unwrap_or_else(|_| chrono::Utc::now())
}
pub fn row_opt_dt(row: &sqlx::postgres::PgRow, idx: usize) -> Option<chrono::DateTime<chrono::Utc>> {
    row.try_get::<Option<chrono::DateTime<chrono::Utc>>, usize>(idx).ok().flatten()
}
pub fn row_json(row: &sqlx::postgres::PgRow, idx: usize) -> serde_json::Value {
    row.try_get::<Option<serde_json::Value>, usize>(idx).ok().flatten().unwrap_or(serde_json::Value::Null)
}

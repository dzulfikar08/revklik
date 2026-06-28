pub mod analytics;
pub mod sites;
pub mod tokens;
pub mod whoami;

use crate::state::AppState;
use axum::routing::{delete, get, post};
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/whoami", get(whoami::whoami))
        .route("/sites", get(sites::list))
        .route("/sites/:site_id", get(sites::get_one))
        .route("/tokens", get(tokens::list).post(tokens::create))
        .route("/tokens/:id", delete(tokens::revoke))
        // analytics (PublicAuth rvt_/rv_)
        .route("/analytics/overview", get(analytics::overview))
        .route("/analytics/timeseries", get(analytics::timeseries))
        .route("/analytics/pages", get(analytics::pages))
        .route("/analytics/referrers", get(analytics::referrers))
        .route("/analytics/geo", get(analytics::geo))
        .route("/analytics/devices", get(analytics::devices))
        .route("/analytics/revenue", get(analytics::revenue))
        .route("/analytics/campaigns", get(analytics::campaigns))
        .route("/analytics/export", get(analytics::export))
}

use crate::error::AppResult;
use crate::middleware::auth::PublicAuth;
use crate::routes::tokens as t;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;

pub async fn list(auth: PublicAuth, State(state): State<AppState>) -> AppResult<Response> {
    t::list(auth.0, State(state)).await
}
pub async fn create(
    auth: PublicAuth,
    State(state): State<AppState>,
    body: axum::Json<t::CreateReq>,
) -> AppResult<Response> {
    t::create(auth.0, State(state), body).await
}
pub async fn revoke(auth: PublicAuth, State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Response> {
    t::revoke(auth.0, State(state), Path(id)).await
}

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Unified application error. Maps to the same JSON envelope the TS API used:
/// `{ "error": "...", "success": false }` (or `{ "success": true, "data": ... }` on ok).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Unauthorized")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("Not found")]
    NotFound,
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Rate limit exceeded")]
    RateLimited { retry_after_secs: u64 },
    #[error("Quota exceeded: {0}")]
    QuotaExceeded(String),
    #[error("{0}")]
    Internal(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl AppError {
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, payload) = match &self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, json!({ "error": m, "success": false })),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, json!({ "error": "Unauthorized", "success": false })),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, json!({ "error": m, "success": false })),
            AppError::NotFound => (StatusCode::NOT_FOUND, json!({ "error": "Not found", "success": false })),
            AppError::Conflict(m) => (StatusCode::CONFLICT, json!({ "error": m, "success": false })),
            AppError::RateLimited { retry_after_secs } => {
                (StatusCode::TOO_MANY_REQUESTS, json!({ "error": "Rate limit exceeded", "success": false, "retry_after": retry_after_secs }))
            }
            AppError::QuotaExceeded(m) => (StatusCode::FORBIDDEN, json!({ "error": m, "success": false })),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": m, "success": false })),
            AppError::Sqlx(e) => {
                tracing::error!(error = ?e, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "Internal server error", "success": false }))
            }
            AppError::Other(e) => {
                tracing::error!(error = ?e, "unexpected error");
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "Internal server error", "success": false }))
            }
        };

        let mut resp = (status, axum::Json(payload)).into_response();
        if let AppError::RateLimited { retry_after_secs } = &self {
            if let Ok(hv) = retry_after_secs.to_string().parse() {
                resp.headers_mut().insert("retry-after", hv);
            }
        }
        resp
    }
}

pub type AppResult<T> = Result<T, AppError>;

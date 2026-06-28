use crate::db::models::TokenType;
use crate::error::{AppError, AppResult};
use crate::middleware::auth::Auth;

/// Validate that `auth` may access `site_id`: owner, or accepted team member.
/// Site tokens (rv_) are additionally restricted to their bound site_id.
pub async fn require(db: &sqlx::PgPool, auth: &Auth, site_id: &str) -> AppResult<()> {
    if auth.token_type == TokenType::Site {
        match &auth.site_id {
            Some(sid) if sid == site_id => return Ok(()),
            _ => return Err(AppError::Forbidden("Token not valid for this site".into())),
        }
    }
    let ok: Option<(i64,)> = sqlx::query_as(
        "SELECT 1::bigint FROM sites s WHERE s.id = $1 AND (s.user_id = $2 OR EXISTS \
         (SELECT 1 FROM team_members t WHERE t.site_id = s.id AND t.user_id = $2 AND t.accepted_at IS NOT NULL))",
    )
    .bind(site_id)
    .bind(&auth.user_id)
    .fetch_optional(db)
    .await?;
    if ok.is_some() {
        Ok(())
    } else {
        Err(AppError::Forbidden("No access to this site".into()))
    }
}

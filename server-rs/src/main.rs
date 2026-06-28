mod config;
mod db;
mod error;
mod jobs;
mod middleware;
mod queries;
mod routes;
mod services;
mod state;
mod web;

/// Backfill continuous aggregates. Idempotent; safe to run every boot. Non-fatal.
async fn refresh_caggs(db: &sqlx::PgPool) {
    for cagg in ["events_hourly", "sessions_daily"] {
        let res = sqlx::query(&format!(
            "CALL refresh_continuous_aggregate('{cagg}', NULL, NULL)"
        ))
        .execute(db)
        .await;
        match res {
            Ok(_) => tracing::info!(cagg, "refreshed continuous aggregate"),
            Err(e) => tracing::warn!(cagg, error = ?e, "cagg refresh failed (continuing)"),
        }
    }
}


use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn,hyper=warn,reqwest=warn".into()),
        )
        .init();

    let has_db_url = std::env::var("REV_DATABASE_URL").is_ok() || std::env::var("DATABASE_URL").is_ok();

    let config = if has_db_url {
        config::Config::from_env().unwrap_or_else(|e| {
            tracing::warn!(error = ?e, "config load failed, using defaults");
            config::Config::default()
        })
    } else {
        config::Config::default()
    };
    let config = Arc::new(config);

    tracing::info!(host = %config.host, port = config.port, "starting revklik-server");

    let db = db::connect(&config.database_url).await?;

    // Run migrations (Timescale + caggs). Gated: only one writer needed; sqlx migrate
    // is idempotent and transactional per file.
    tracing::info!("running migrations");
    sqlx::migrate!("./migrations").run(&db).await?;

    // refresh_continuous_aggregate cannot run inside a transaction (sqlx wraps each
    // migration file in one), so backfill caggs here after migrations complete.
    refresh_caggs(&db).await;

    let geoip = services::geoip::Geoip::open(config.geoip_db_path.as_ref());
    let state = state::AppState::new(db.clone(), config.clone(), geoip);

    // CORS: allow configured origins (or wildcard for the public track endpoints).
    let cors: CorsLayer = if config.cors_origins.trim() == "*" {
        CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)
    } else {
        let origins: Vec<_> = config
            .cors_origin_list()
            .into_iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
            .expose_headers([axum::http::header::RETRY_AFTER, "x-ratelimit-limit".parse().unwrap(), "x-ratelimit-remaining".parse().unwrap(), "x-ratelimit-reset".parse().unwrap()])
    };

    let app = routes::router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Serve built SPA (client/dist) at non-/api/* paths. SPA fallback to index.html.
    let app = if let Some(dir) = config.static_dir.as_deref().filter(|d| std::path::Path::new(d).exists()) {
        tracing::info!(static_dir = %dir, "serving SPA");
        use tower_http::services::{ServeDir, ServeFile};
        let index = std::path::Path::new(dir).join("index.html");
        let spa = ServeDir::new(dir).not_found_service(ServeFile::new(index));
        app.fallback_service(spa)
    } else {
        tracing::info!("static_dir not set/missing — API-only mode");
        app
    };

    // Spawn periodic jobs (Polar sync, retention drop_chunks, ai cleanup) — advisory-locked.
    if config.enable_jobs {
        jobs::spawn(db.clone(), config.polar_access_token.clone(), config.polar_org_id.clone(), reqwest::Client::new());
    }

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

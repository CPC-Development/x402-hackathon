mod config;
mod crypto;
mod db;
mod error;
mod handlers;
mod model;
mod openapi;
mod service;

use std::{net::SocketAddr, sync::Arc};

use dotenvy::dotenv;
use ethers_providers::{Http, Provider};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    config::Config,
    db::{init_db, load_state},
    handlers::router,
    openapi::ApiDoc,
    service::AppState,
};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Arc::new(Config::from_env()?);
    let port = config.port;

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;

    init_db(&db).await?;
    let channels = load_state(&db).await?;

    let provider = Arc::new(Provider::<Http>::try_from(config.rpc_url.as_str())?);

    let state = AppState {
        db,
        channels: Arc::new(RwLock::new(channels)),
        config,
        provider,
    };

    let app = router(state).merge(SwaggerUi::new("/docs").url("/openapi.json", ApiDoc::openapi()));
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("sequencer listening on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

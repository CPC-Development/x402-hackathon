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
use ethers_signers::{LocalWallet, Signer};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    config::Config,
    db::{init_db, load_state},
    handlers::router,
    openapi::ApiDoc,
    service::{fetch_sequencer_address, AppState},
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
    let sequencer_wallet = config.sequencer_private_key.parse::<LocalWallet>()?.with_chain_id(config.chain_id);
    let sequencer_address = sequencer_wallet.address();
    let onchain_sequencer = fetch_sequencer_address(provider.clone(), config.channel_manager).await?;
    if onchain_sequencer != sequencer_address {
        return Err(format!(
            "sequencer address mismatch: config={}, on-chain={}",
            sequencer_address, onchain_sequencer
        )
        .into());
    }

    let state = AppState {
        db,
        channels: Arc::new(RwLock::new(channels)),
        config,
        provider,
        sequencer_wallet,
    };

    let app = router(state).merge(SwaggerUi::new("/docs").url("/openapi.json", ApiDoc::openapi()));
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("sequencer listening on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

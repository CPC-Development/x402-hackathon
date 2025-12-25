use ethers_core::types::Address;
use std::str::FromStr;

use crate::error::AppError;

const DEFAULT_DATABASE_URL: &str = "postgres://x402:x402@localhost:5432/x402";
const DEFAULT_CHAIN_ID: u64 = 31337;
const DEFAULT_MAX_RECIPIENTS: usize = 30;
const DEFAULT_PORT: u16 = 4001;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub chain_id: u64,
    pub channel_manager: Address,
    pub max_recipients: usize,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string());
        let chain_id = std::env::var("CHAIN_ID")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_CHAIN_ID);
        let channel_manager = std::env::var("CHANNEL_MANAGER_ADDRESS")
            .ok()
            .and_then(|v| Address::from_str(&v).ok())
            .unwrap_or(Address::zero());
        let max_recipients = std::env::var("MAX_RECIPIENTS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(DEFAULT_MAX_RECIPIENTS);
        let port = std::env::var("PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);

        if channel_manager == Address::zero() {
            return Err(AppError::bad_request("CHANNEL_MANAGER_ADDRESS is not set"));
        }

        Ok(Self {
            database_url,
            chain_id,
            channel_manager,
            max_recipients,
            port,
        })
    }
}

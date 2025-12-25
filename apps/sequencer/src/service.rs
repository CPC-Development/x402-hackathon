use std::{collections::HashMap, sync::Arc};

use ethers_core::types::{Address, U256};
use tracing::info;
use tokio::sync::RwLock;

use crate::{
    config::Config,
    crypto::{parse_address, parse_h256, parse_u256, recover_signature, validate_timestamp},
    db::{save_channel},
    error::AppError,
    model::{ChannelState, ChannelView, PayInChannelRequest, PayInChannelResponse, RecipientBalance, SeedChannelRequest},
};
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub channels: Arc<RwLock<HashMap<String, ChannelState>>>,
    pub config: Arc<Config>,
}

pub async fn seed_channel(state: &AppState, payload: SeedChannelRequest) -> Result<ChannelView, AppError> {
    let channel_id = parse_h256(&payload.channel_id)?;
    let owner = parse_address(&payload.owner)?;
    let balance = parse_u256(&payload.balance)?;

    let channel_state = ChannelState {
        channel_id,
        owner,
        balance,
        expiry_ts: payload.expiry_timestamp,
        sequence_number: 0,
        user_signature: String::new(),
        signature_timestamp: 0,
        recipients: Vec::new(),
    };

    save_channel(&state.db, &channel_state).await?;

    let mut channels = state.channels.write().await;
    channels.insert(payload.channel_id.clone(), channel_state);

    let view = ChannelView::from_state(channels.get(&payload.channel_id).unwrap());
    Ok(view)
}

pub async fn get_channel(state: &AppState, channel_id: String) -> Result<ChannelView, AppError> {
    let channels = state.channels.read().await;
    let channel = channels
        .get(&channel_id)
        .ok_or_else(|| AppError::not_found("channel not found"))?;
    Ok(ChannelView::from_state(channel))
}

pub async fn pay_in_channel(state: &AppState, payload: PayInChannelRequest) -> Result<PayInChannelResponse, AppError> {
    let channel_id = parse_h256(&payload.channel_id)?;
    let receiver = parse_address(&payload.receiver)?;
    let amount = parse_u256(&payload.amount)?;
    let fee = payload
        .fee_for_payment
        .as_ref()
        .map(|fee| -> Result<(Address, U256), AppError> {
            let fee_address = parse_address(&fee.fee_destination_address)?;
            let fee_amount = parse_u256(&fee.fee_amount_curds)?;
            Ok((fee_address, fee_amount))
        })
        .transpose()?;

    if amount.is_zero() {
        return Err(AppError::bad_request("amount must be greater than zero"));
    }

    if let Some(purpose) = payload.purpose.as_deref() {
        info!(
            purpose = %purpose,
            channel_id = %format!("0x{:x}", channel_id),
            "pay-in-channel purpose"
        );
    }

    let mut channels = state.channels.write().await;
    let channel = channels
        .get_mut(&payload.channel_id)
        .ok_or_else(|| AppError::not_found("channel not found"))?;

    if payload.sequence_number == channel.sequence_number {
        if payload.user_signature == channel.user_signature && payload.timestamp == channel.signature_timestamp {
            return Ok(PayInChannelResponse {
                channel: ChannelView::from_state(channel),
            });
        }
        return Err(AppError::bad_request("sequence already processed"));
    }

    if payload.sequence_number != channel.sequence_number + 1 {
        return Err(AppError::bad_request("invalid sequence number"));
    }

    validate_timestamp(payload.timestamp, channel.expiry_ts)?;

    let mut recipients = channel.recipients.clone();
    add_amount(&mut recipients, receiver, amount);
    if let Some((fee_address, fee_amount)) = fee {
        add_amount(&mut recipients, fee_address, fee_amount);
    }

    if recipients.len() > state.config.max_recipients {
        return Err(AppError::bad_request("max recipients exceeded"));
    }

    let total = recipients
        .iter()
        .fold(U256::zero(), |acc, r| acc + r.balance);
    if total > channel.balance {
        return Err(AppError::bad_request("exceeds channel capacity"));
    }

    let recovered = recover_signature(
        channel.channel_id,
        payload.sequence_number,
        payload.timestamp,
        &recipients,
        state.config.chain_id,
        state.config.channel_manager,
        &payload.user_signature,
    )?;

    if recovered != channel.owner {
        return Err(AppError::bad_request("invalid user signature"));
    }

    channel.sequence_number = payload.sequence_number;
    channel.user_signature = payload.user_signature.clone();
    channel.signature_timestamp = payload.timestamp;
    channel.recipients = recipients;

    save_channel(&state.db, channel).await?;

    Ok(PayInChannelResponse {
        channel: ChannelView::from_state(channel),
    })
}

fn add_amount(recipients: &mut Vec<RecipientBalance>, address: Address, amount: U256) {
    if amount.is_zero() {
        return;
    }

    if let Some(existing) = recipients.iter_mut().find(|r| r.recipient_address == address) {
        existing.balance += amount;
        return;
    }

    let position = recipients.len() as i32;
    recipients.push(RecipientBalance {
        recipient_address: address,
        balance: amount,
        position,
    });
}

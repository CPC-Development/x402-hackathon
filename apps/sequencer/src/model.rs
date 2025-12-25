use ethers_core::types::{Address, H256, U256};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone)]
pub struct ChannelState {
    pub channel_id: H256,
    pub owner: Address,
    pub balance: U256,
    pub expiry_ts: u64,
    pub sequence_number: u64,
    pub user_signature: String,
    pub sequencer_signature: String,
    pub signature_timestamp: u64,
    pub recipients: Vec<RecipientBalance>,
}

#[derive(Debug, Clone)]
pub struct RecipientBalance {
    pub recipient_address: Address,
    pub balance: U256,
    pub position: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeedChannelRequest {
    pub channel_id: String,
    pub owner: String,
    pub balance: String,
    pub expiry_timestamp: u64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeeForPayment {
    pub fee_destination_address: String,
    pub fee_amount_curds: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayInChannelRequest {
    pub channel_id: String,
    pub amount: String,
    pub receiver: String,
    pub sequence_number: u64,
    pub timestamp: u64,
    pub user_signature: String,
    pub purpose: Option<String>,
    pub fee_for_payment: Option<FeeForPayment>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelView {
    pub channel_id: String,
    pub owner: String,
    pub balance: String,
    pub expiry_timestamp: u64,
    pub sequence_number: u64,
    pub user_signature: String,
    pub sequencer_signature: String,
    pub signature_timestamp: u64,
    pub recipients: Vec<RecipientView>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecipientView {
    pub recipient_address: String,
    pub balance: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayInChannelResponse {
    pub channel: ChannelView,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelsByOwnerResponse {
    pub owner: String,
    pub channel_ids: Vec<String>,
}

impl ChannelView {
    pub fn from_state(channel: &ChannelState) -> Self {
        Self {
            channel_id: format!("0x{:x}", channel.channel_id),
            owner: format!("0x{:x}", channel.owner),
            balance: channel.balance.to_string(),
            expiry_timestamp: channel.expiry_ts,
            sequence_number: channel.sequence_number,
            user_signature: channel.user_signature.clone(),
            sequencer_signature: channel.sequencer_signature.clone(),
            signature_timestamp: channel.signature_timestamp,
            recipients: channel
                .recipients
                .iter()
                .map(|r| RecipientView {
                    recipient_address: format!("0x{:x}", r.recipient_address),
                    balance: r.balance.to_string(),
                })
                .collect(),
        }
    }
}

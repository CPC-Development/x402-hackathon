use ethers_core::{
    abi::{encode, Token},
    types::{Address, H256, Signature, U256},
    utils::keccak256,
};
use ethers_signers::LocalWallet;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::error::AppError;
use crate::model::RecipientBalance;

const DOMAIN_NAME: &str = "X402CheddrPaymentChannel";
const DOMAIN_VERSION: &str = "1";

pub fn parse_address(input: &str) -> Result<Address, AppError> {
    Address::from_str(input).map_err(|_| AppError::bad_request(format!("invalid address: {input}")))
}

pub fn parse_h256(input: &str) -> Result<H256, AppError> {
    H256::from_str(input).map_err(|_| AppError::bad_request(format!("invalid channel id: {input}")))
}

pub fn parse_u256(input: &str) -> Result<U256, AppError> {
    U256::from_dec_str(input).map_err(|_| AppError::bad_request(format!("invalid uint256: {input}")))
}

pub fn validate_timestamp(timestamp: u64, expiry_ts: u64) -> Result<(), AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs();
    let max_future = now + 15 * 60;
    if timestamp > max_future {
        return Err(AppError::bad_request("timestamp is too far in the future"));
    }
    if timestamp > expiry_ts {
        return Err(AppError::bad_request("timestamp is after channel expiry"));
    }
    Ok(())
}

pub fn recover_signature(
    channel_id: H256,
    sequence_number: u64,
    timestamp: u64,
    recipients: &[RecipientBalance],
    chain_id: u64,
    verifying_contract: Address,
    signature: &str,
) -> Result<Address, AppError> {
    let digest = channel_update_digest(
        channel_id,
        sequence_number,
        timestamp,
        recipients,
        chain_id,
        verifying_contract,
    );
    let sig = Signature::from_str(signature)
        .map_err(|e| AppError::bad_request(format!("invalid signature: {e}")))?;
    sig.recover(digest)
        .map_err(|e| AppError::bad_request(format!("signature recovery failed: {e}")))
}

pub fn sign_update(
    wallet: &LocalWallet,
    channel_id: H256,
    sequence_number: u64,
    timestamp: u64,
    recipients: &[RecipientBalance],
    chain_id: u64,
    verifying_contract: Address,
) -> Result<String, AppError> {
    let digest = channel_update_digest(
        channel_id,
        sequence_number,
        timestamp,
        recipients,
        chain_id,
        verifying_contract,
    );
    let signature = wallet
        .sign_hash(digest)
        .map_err(|e| AppError::bad_request(format!("sequencer signing failed: {e}")))?;
    Ok(signature.to_string())
}

fn channel_update_digest(
    channel_id: H256,
    sequence_number: u64,
    timestamp: u64,
    recipients: &[RecipientBalance],
    chain_id: u64,
    verifying_contract: Address,
) -> H256 {
    let recipients_hash = hash_addresses(recipients.iter().map(|r| r.recipient_address));
    let amounts_hash = hash_u256s(recipients.iter().map(|r| r.balance));

    let type_hash = keccak256(
        b"ChannelData(bytes32 channelId,uint256 sequenceNumber,uint256 timestamp,address[] recipients,uint256[] amounts)",
    );

    let struct_encoded = encode(&[
        Token::FixedBytes(type_hash.to_vec()),
        Token::FixedBytes(channel_id.as_bytes().to_vec()),
        Token::Uint(U256::from(sequence_number)),
        Token::Uint(U256::from(timestamp)),
        Token::FixedBytes(recipients_hash.as_bytes().to_vec()),
        Token::FixedBytes(amounts_hash.as_bytes().to_vec()),
    ]);
    let struct_hash = H256::from(keccak256(struct_encoded));

    let domain_separator = domain_separator(chain_id, verifying_contract);

    let mut digest_input = Vec::with_capacity(2 + 32 + 32);
    digest_input.extend_from_slice(&[0x19, 0x01]);
    digest_input.extend_from_slice(domain_separator.as_bytes());
    digest_input.extend_from_slice(struct_hash.as_bytes());
    H256::from(keccak256(digest_input))
}

fn domain_separator(chain_id: u64, verifying_contract: Address) -> H256 {
    let domain_type_hash = keccak256(
        b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    );
    let name_hash = keccak256(DOMAIN_NAME.as_bytes());
    let version_hash = keccak256(DOMAIN_VERSION.as_bytes());

    let encoded = encode(&[
        Token::FixedBytes(domain_type_hash.to_vec()),
        Token::FixedBytes(name_hash.to_vec()),
        Token::FixedBytes(version_hash.to_vec()),
        Token::Uint(U256::from(chain_id)),
        Token::Address(verifying_contract),
    ]);

    H256::from(keccak256(encoded))
}

fn hash_addresses<I>(iter: I) -> H256
where
    I: IntoIterator<Item = Address>,
{
    let mut bytes = Vec::new();
    for address in iter {
        bytes.extend_from_slice(address.as_bytes());
    }
    H256::from(keccak256(bytes))
}

fn hash_u256s<I>(iter: I) -> H256
where
    I: IntoIterator<Item = U256>,
{
    let mut bytes = Vec::new();
    for value in iter {
        let mut buf = [0u8; 32];
        value.to_big_endian(&mut buf);
        bytes.extend_from_slice(&buf);
    }
    H256::from(keccak256(bytes))
}

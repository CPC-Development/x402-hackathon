use sqlx::{PgPool, Row};
use std::collections::HashMap;

use crate::crypto::{parse_address, parse_h256, parse_u256};
use crate::model::{ChannelState, RecipientBalance};

pub async fn init_db(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS channels (\
            channel_id TEXT PRIMARY KEY,\
            owner TEXT NOT NULL,\
            balance TEXT NOT NULL,\
            expiry_ts BIGINT NOT NULL,\
            sequence_number BIGINT NOT NULL,\
            user_signature TEXT NOT NULL,\
            signature_timestamp BIGINT NOT NULL\
        )",
    )
    .execute(db)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS recipients (\
            channel_id TEXT NOT NULL,\
            recipient_address TEXT NOT NULL,\
            balance TEXT NOT NULL,\
            position INT NOT NULL,\
            PRIMARY KEY (channel_id, recipient_address),\
            FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE\
        )",
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn load_state(db: &PgPool) -> Result<HashMap<String, ChannelState>, sqlx::Error> {
    let mut map = HashMap::new();
    let rows = sqlx::query(
        "SELECT channel_id, owner, balance, expiry_ts, sequence_number, user_signature, signature_timestamp FROM channels",
    )
    .fetch_all(db)
    .await?;

    for row in rows {
        let channel_id_str: String = row.try_get("channel_id")?;
        let owner_str: String = row.try_get("owner")?;
        let balance_str: String = row.try_get("balance")?;
        let expiry_ts: i64 = row.try_get("expiry_ts")?;
        let sequence_number: i64 = row.try_get("sequence_number")?;
        let user_signature: String = row.try_get("user_signature")?;
        let signature_timestamp: i64 = row.try_get("signature_timestamp")?;

        let recipients_rows = sqlx::query(
            "SELECT recipient_address, balance, position FROM recipients WHERE channel_id = $1 ORDER BY position",
        )
        .bind(&channel_id_str)
        .fetch_all(db)
        .await?;

        let mut recipients = Vec::new();
        for recipient_row in recipients_rows {
            let address_str: String = recipient_row.try_get("recipient_address")?;
            let balance_str: String = recipient_row.try_get("balance")?;
            let position: i32 = recipient_row.try_get("position")?;
            recipients.push(RecipientBalance {
                recipient_address: parse_address(&address_str).unwrap_or_default(),
                balance: parse_u256(&balance_str).unwrap_or_default(),
                position,
            });
        }

        let channel_state = ChannelState {
            channel_id: parse_h256(&channel_id_str).unwrap_or_default(),
            owner: parse_address(&owner_str).unwrap_or_default(),
            balance: parse_u256(&balance_str).unwrap_or_default(),
            expiry_ts: expiry_ts as u64,
            sequence_number: sequence_number as u64,
            user_signature,
            signature_timestamp: signature_timestamp as u64,
            recipients,
        };

        map.insert(channel_id_str, channel_state);
    }

    Ok(map)
}

pub async fn save_channel(db: &PgPool, channel: &ChannelState) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO channels (channel_id, owner, balance, expiry_ts, sequence_number, user_signature, signature_timestamp)\
         VALUES ($1, $2, $3, $4, $5, $6, $7)\
         ON CONFLICT (channel_id) DO UPDATE SET\
            owner = EXCLUDED.owner,\
            balance = EXCLUDED.balance,\
            expiry_ts = EXCLUDED.expiry_ts,\
            sequence_number = EXCLUDED.sequence_number,\
            user_signature = EXCLUDED.user_signature,\
            signature_timestamp = EXCLUDED.signature_timestamp",
    )
    .bind(format!("0x{:x}", channel.channel_id))
    .bind(format!("0x{:x}", channel.owner))
    .bind(channel.balance.to_string())
    .bind(channel.expiry_ts as i64)
    .bind(channel.sequence_number as i64)
    .bind(channel.user_signature.clone())
    .bind(channel.signature_timestamp as i64)
    .execute(db)
    .await?;

    for recipient in &channel.recipients {
        sqlx::query(
            "INSERT INTO recipients (channel_id, recipient_address, balance, position)\
             VALUES ($1, $2, $3, $4)\
             ON CONFLICT (channel_id, recipient_address) DO UPDATE SET\
                balance = EXCLUDED.balance,\
                position = EXCLUDED.position",
        )
        .bind(format!("0x{:x}", channel.channel_id))
        .bind(format!("0x{:x}", recipient.recipient_address))
        .bind(recipient.balance.to_string())
        .bind(recipient.position)
        .execute(db)
        .await?;
    }

    Ok(())
}

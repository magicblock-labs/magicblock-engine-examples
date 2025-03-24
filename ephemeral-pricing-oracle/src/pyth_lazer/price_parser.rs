use crate::types::{SolanaMessage, TemporalNumericValue, UpdateData};
use base64::Engine;
use serde_json::Value;

pub fn parse_price_update(message: &str) -> Result<Vec<UpdateData>, Box<dyn std::error::Error>> {
    let value: Value = serde_json::from_str(message)?;

    let parsed = value
        .get("parsed")
        .ok_or("Missing parsed field")?
        .as_object()
        .ok_or("Parsed field is not an object")?;

    let solana_data = value
        .get("solana")
        .ok_or("Missing solana field")?
        .get("data")
        .ok_or("Missing data field")?
        .as_str()
        .ok_or("Data is not a string")?;

    let timestamp_us = parsed
        .get("timestampUs")
        .ok_or("Missing timestampUs")?
        .as_str()
        .ok_or("timestampUs is not a string")?
        .parse::<u64>()?;

    let price_feeds = parsed
        .get("priceFeeds")
        .ok_or("Missing priceFeeds")?
        .as_array()
        .ok_or("priceFeeds is not an array")?;

    let decoded_data = base64::engine::general_purpose::STANDARD.decode(solana_data)?;
    let message = SolanaMessage::deserialize_slice(decoded_data.as_slice())?;

    let mut price_updates = Vec::with_capacity(price_feeds.len());

    for price_feed in price_feeds {
        let price_feed_obj = price_feed
            .as_object()
            .ok_or("Price feed is not an object")?;

        let price_feed_id = price_feed_obj
            .get("priceFeedId")
            .ok_or("Missing priceFeedId")?
            .as_u64()
            .ok_or("priceFeedId is not a number")?;

        let price = price_feed_obj
            .get("price")
            .ok_or("Missing price")?
            .as_str()
            .ok_or("Price is not a string")?;

        let update_data = UpdateData {
            symbol: price_feed_id.to_string(),
            id: {
                let mut id = [0u8; 32];
                let bytes = price_feed_id.to_le_bytes();
                id[..bytes.len()].copy_from_slice(&bytes);
                id
            },
            temporal_numeric_value: TemporalNumericValue {
                timestamp_ns: timestamp_us * 1000, // Convert microseconds to nanoseconds
                quantized_value: price.parse::<i128>()?,
            },
            publisher_merkle_root: message.public_key,
            r: message.signature[0..32].try_into()?,
            s: message.signature[32..64].try_into()?,
            ..UpdateData::default()
        };

        price_updates.push(update_data);
    }

    Ok(price_updates)
}

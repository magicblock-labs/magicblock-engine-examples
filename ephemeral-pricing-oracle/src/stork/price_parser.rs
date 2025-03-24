use crate::types::{TemporalNumericValue, UpdateData};
use bigdecimal::{BigDecimal, ToPrimitive};
use serde_json::Value;
use std::str::FromStr;

pub fn parse_price_update(message: &str) -> Result<Vec<UpdateData>, Box<dyn std::error::Error>> {
    let value: Value = serde_json::from_str(message)?;

    let data = value
        .get("data")
        .ok_or("Missing data field")?
        .as_object()
        .ok_or("Data field is not an object")?;

    let mut price_updates = Vec::with_capacity(data.len());

    for (asset_id, price_data) in data {
        let update_data = parse_price_data_to_update(asset_id, price_data)?;
        price_updates.push(update_data);
    }
    Ok(price_updates)
}
fn parse_price_data_to_update(
    symbol: &String,
    message: &Value,
) -> Result<UpdateData, Box<dyn std::error::Error>> {
    let stork_signed = message
        .get("stork_signed_price")
        .ok_or("Missing stork_signed_price")?;

    let signature = stork_signed
        .get("timestamped_signature")
        .and_then(|ts| ts.get("signature"))
        .ok_or("Missing signature")?;

    let timestamp = message
        .get("timestamp")
        .and_then(|t| t.as_u64())
        .ok_or("Missing timestamp")?;

    let price_str = message
        .get("price")
        .and_then(|p| p.as_str())
        .ok_or("Missing price")?;
    let price = BigDecimal::from_str(price_str)?;

    let encoded_asset_id = stork_signed
        .get("encoded_asset_id")
        .and_then(|id| id.as_str())
        .ok_or("Missing encoded_asset_id")?;
    let id = hex::decode(&encoded_asset_id[2..])?
        .try_into()
        .map_err(|_| "Invalid asset id length")?;

    let publisher_root = stork_signed
        .get("publisher_merkle_root")
        .and_then(|root| root.as_str())
        .ok_or("Missing publisher_merkle_root")?;
    let publisher_merkle_root = hex::decode(&publisher_root[2..])?
        .try_into()
        .map_err(|_| "Invalid merkle root length")?;

    let alg = stork_signed
        .get("calculation_alg")
        .ok_or("Missing calculation_alg")?;
    let alg_checksum = alg
        .get("checksum")
        .and_then(|c| c.as_str())
        .ok_or("Missing checksum")?;
    let value_compute_alg_hash = hex::decode(alg_checksum)?
        .try_into()
        .map_err(|_| "Invalid checksum length")?;

    let r_hex = signature
        .get("r")
        .and_then(|r| r.as_str())
        .ok_or("Missing r")?;
    let r = hex::decode(&r_hex[2..])?
        .try_into()
        .map_err(|_| "Invalid r length")?;

    let s_hex = signature
        .get("s")
        .and_then(|s| s.as_str())
        .ok_or("Missing s")?;
    let s = hex::decode(&s_hex[2..])?
        .try_into()
        .map_err(|_| "Invalid s length")?;

    let v_hex = signature
        .get("v")
        .and_then(|v| v.as_str())
        .ok_or("Missing v")?;
    let v = u8::from_str_radix(&v_hex[2..], 16)?;

    Ok(UpdateData {
        symbol: symbol.to_string(),
        id,
        temporal_numeric_value: TemporalNumericValue {
            timestamp_ns: timestamp,
            quantized_value: (price / BigDecimal::from(1_000_000))
                .to_i128()
                .unwrap_or_default(),
        },
        publisher_merkle_root,
        value_compute_alg_hash,
        r,
        s,
        v,
    })
}

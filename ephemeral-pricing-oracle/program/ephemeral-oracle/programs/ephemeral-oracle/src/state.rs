use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug)]
pub struct TemporalNumericValue {
    pub timestamp_ns: u64,
    pub quantized_value: i128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateData {
    pub symbol: String,
    pub id: [u8; 32],
    pub temporal_numeric_value: TemporalNumericValue,
    pub publisher_merkle_root: [u8; 32],
    pub value_compute_alg_hash: [u8; 32],
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub v: u8,
}

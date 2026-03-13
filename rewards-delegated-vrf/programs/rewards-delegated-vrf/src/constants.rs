/// PDA Seeds for accounts
pub const REWARD_DISTRIBUTOR_SEED: &[u8] = b"reward_distributor";
pub const REWARD_LIST_SEED: &[u8] = b"reward_list";
pub const TRANSFER_LOOKUP_TABLE_SEED: &[u8] = b"transfer_lookup_table";

/// Metaplex constants
pub const RULE_SET_SEED: &[u8] = b"rule_set";
pub const METADATA_SEED: &[u8] = b"metadata";
pub const EDITION_SEED: &[u8] = b"edition";
pub const TOKEN_RECORD_SEED: &[u8] = b"token_record";

/// Space calculations
/// Discriminator: 8 bytes
/// RewardsList fixed fields: 32 (Pubkey) + 1 (u8) + 4 (Vec header) + 8 (i64) + 8 (i64) + 4 (u32) + 4 (u32) = 61 bytes
/// Per Reward (with buffer for dynamic String and Vec):
///   - name (String with content): 50 bytes (4 byte length + 46 bytes content)
///   - draw_range_min (u32): 4 bytes
///   - draw_range_max (u32): 4 bytes
///   - reward_type (enum): 1 byte
///   - reward_mints (Vec): 4 (header) + 25 * 32 (Pubkey) = 804 bytes
///   - reward_amount (u64): 8 bytes
///   - redemption_count (u64): 8 bytes
///   - redemption_limit (u64): 8 bytes
///   - additional_pubkeys (Vec): 4 (header) + 3 * 32 (Pubkey) = 100 bytes
///   Per reward subtotal: 50 + 4 + 4 + 1 + 804 + 8 + 8 + 8 + 100 = 987 bytes
/// 10 rewards: 10 * 987 = 9,870 bytes
/// TOTAL: 8 + 61 + (10 * 987) = 9,939 bytes (under 10KB realloc limit)
pub const REWARD_LIST_SPACE: usize =
    8 + 61 + (10 * (50 + 4 + 4 + 1 + (4 + 25 * 32) + 8 + 8 + 8 + (4 + 3 * 32)));

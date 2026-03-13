use anchor_lang::prelude::*;

#[account]
pub struct RewardDistributor {
    pub super_admin: Pubkey,
    pub bump: u8,
    pub admins: Vec<Pubkey>,
    pub whitelist: Vec<Pubkey>,
}

#[account]
pub struct RewardsList {
    pub reward_distributor: Pubkey,
    pub bump: u8,
    pub rewards: Vec<Reward>,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub global_range_min: u32,
    pub global_range_max: u32,
}

impl RewardsList {
    // Fixed fields: 32 (Pubkey) + 1 (u8) + 4 (vec header) + 8 (i64) + 8 (i64) + 4 (u32) + 4 (u32) = 61
    pub const MAX_SIZE: usize = 32 + 1 + 4 + 8 + 8 + 4 + 4;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Reward {
    pub name: String,
    pub draw_range_min: u32,
    pub draw_range_max: u32,
    pub reward_type: RewardType,
    pub reward_mints: Vec<Pubkey>,
    pub reward_amount: u64,
    pub redemption_count: u64,
    pub redemption_limit: u64,
    pub additional_pubkeys: Vec<Pubkey>,
}

impl Reward {
    // 50 + 4 + 4 + 1 + 4 + (32 * 25) + 8 + 8 + 8 + 4 + (32 * 3) = 987
    // name: 4 (length) + 46 (content) = 50, draw_range_min: 4, draw_range_max: 4, reward_type: 1, reward_mints vec header: 4, reward_mints (25 max): 800, reward_amount: 8, redemption_count: 8, redemption_limit: 8, additional_pubkeys vec header: 4, additional_pubkeys (3 max): 96
    pub const MAX_SIZE: usize = 50 + 4 + 4 + 1 + 4 + (32 * 25) + 8 + 8 + 8 + 4 + (32 * 3);
}

#[account]
pub struct TransferLookupTable {
    pub bump: u8,
    pub lookup_accounts: Vec<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Default, Debug)]
pub enum RewardType {
    #[default]
    SplToken,
    LegacyNft,
    ProgrammableNft,
    SplToken2022,
    CompressedNft,
}

impl RewardType {
    pub fn to_seed(&self) -> u8 {
        match self {
            RewardType::SplToken => 0,
            RewardType::LegacyNft => 1,
            RewardType::ProgrammableNft => 2,
            RewardType::SplToken2022 => 3,
            RewardType::CompressedNft => 4,
        }
    }
}

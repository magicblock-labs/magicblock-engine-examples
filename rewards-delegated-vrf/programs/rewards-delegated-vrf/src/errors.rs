use anchor_lang::prelude::*;

#[error_code]
pub enum RewardError {
    #[msg("Reward not found with the specified name")]
    RewardNotFound,

    #[msg("Invalid token account provided")]
    InvalidTokenAccount,

    #[msg("Token account is not owned by the reward distributor")]
    TokenNotOwnedByDistributor,

    #[msg("Token account owner is not the token program")]
    InvalidTokenProgramOwner,

    #[msg("Failed to deserialize token account data")]
    InvalidTokenAccountData,

    #[msg("Unauthorized - caller is not an admin or whitelist member")]
    Unauthorized,

    #[msg("Collection cannot be verified in this instruction")]
    CollectionVerificationFailed,

    #[msg("Reward distribution time window has not started")]
    RewardNotStarted,

    #[msg("Reward distribution time window has ended")]
    RewardEnded,

    #[msg("No rewards available for the drawn value")]
    NoRewardForValue,

    #[msg("Reward redemption limit has been exceeded")]
    RedemptionLimitExceeded,

    #[msg("Invalid reward type for transfer")]
    InvalidRewardType,

    #[msg("Reward type does not match the specified type")]
    RewardTypeMismatch,

    #[msg("Unsupported asset type - only Fungible, NonFungible, and ProgrammableNonFungible are supported")]
    UnsupportedAssetType,

    #[msg("Token rewards cannot be added to existing reward")]
    TokenCannotBeAdded,

    #[msg("ProgrammableNft ruleset does not match the existing reward's ruleset")]
    RulesetMismatch,

    #[msg("Missing required reward parameters for new reward creation")]
    MissingRewardParameters,

    #[msg("ProgrammableNft requires metadata account")]
    MissingMetadataForProgrammableNft,
}

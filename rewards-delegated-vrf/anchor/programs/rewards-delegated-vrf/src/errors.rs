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

    #[msg("Reward type does not match the specified type with existing Reward")]
    RewardTypeMismatch,

    #[msg("Unsupported asset type - only Fungible, NonFungible, and ProgrammableNonFungible are supported")]
    UnsupportedAssetType,

    #[msg("Token rewards cannot be added to existing reward")]
    TokenCannotBeAdded,

    #[msg("ProgrammableNft ruleset does not match the existing reward's ruleset")]
    RulesetMismatch,

    #[msg("Missing required mint")]
    MissingMint,

    #[msg("Missing required reward parameters for new reward creation")]
    MissingRewardParameters,

    #[msg("Missing required parameter: draw_range_min")]
    MissingDrawRangeMin,

    #[msg("Missing required parameter: draw_range_max")]
    MissingDrawRangeMax,

    #[msg("Missing required parameter: reward_amount")]
    MissingRewardAmount,

    #[msg("Missing required parameter: redemption_limit")]
    MissingRedemptionLimit,

    #[msg("ProgrammableNft requires metadata account")]
    MissingMetadataForProgrammableNft,

    #[msg("Reward range exceeds global bounds")]
    RewardRangeExceedsGlobalBounds,

    #[msg("Reward ranges overlap")]
    RewardRangesOverlap,

    #[msg("Provided draw range does not match the existing reward range")]
    RewardRangeMismatch,

    #[msg("Provided reward amount does not match the existing reward amount")]
    RewardAmountMismatch,

    #[msg("Reward name is already used by another reward")]
    DuplicateRewardName,

    #[msg("Existing token rewards require a redemption increment to be provided")]
    MissingRedemptionsAdded,

    #[msg("Mint not found in reward")]
    MintNotFoundInReward,

    #[msg("Insufficient redemption limit to remove")]
    InsufficientRedemptionLimit,

    #[msg("Invalid draw range: draw_range_min must be less than or equal to draw_range_max")]
    InvalidDrawRange,

    #[msg("Invalid redemption state: redemption_count cannot exceed redemption_limit")]
    InvalidRedemptionState,

    #[msg("Invalid reward amount: must be greater than 0")]
    InvalidRewardAmount,

    #[msg("Distributor token account does not hold enough tokens for the requested reward inventory")]
    InsufficientTokenBalanceForReward,

    #[msg("Arithmetic overflow while calculating reward inventory requirements")]
    ArithmeticOverflow,

    #[msg("NFT mint is already used by another reward")]
    NftMintAlreadyAssigned,

    #[msg("Reward list rewards can only be initialized once")]
    RewardListAlreadyInitialized,

    #[msg("Reward does not have enough remaining mints for its remaining redemptions")]
    InsufficientRewardMints,

    #[msg("Missing mint account for reward inventory validation")]
    MissingMintAccountForReward,

    #[msg("Mint is already part of the existing reward")]
    MintAlreadyInReward,

    #[msg("Failed to deserialize the delegation record for reward_list")]
    InvalidDelegationRecord,
}

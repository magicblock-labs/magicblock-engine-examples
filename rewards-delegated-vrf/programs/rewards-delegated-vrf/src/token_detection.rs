use crate::errors::RewardError;
use crate::state::RewardType;
use anchor_lang::prelude::*;
use anchor_spl::metadata::mpl_token_metadata;
use anchor_spl::token_interface::Mint;
use anchor_spl::{token, token_interface};

/// Detects the reward type based on mint characteristics and metadata
///
/// Detection logic:
/// 1. Check if mint is an NFT (supply=1, decimals=0)
///    - If NFT: Check metadata token_standard (NonFungible or ProgrammableNonFungible)
///    - If not NFT: Check mint owner (SPL Token or Token 2022)
/// 2. For non-NFTs: Determine based on token program owner
/// 3. For NFTs: Require metadata and validate token standard
pub fn detect_reward_type(
    mint: &InterfaceAccount<Mint>,
    metadata: &Option<mpl_token_metadata::accounts::Metadata>,
) -> Result<RewardType> {
    let mint_owner = mint.to_account_info().owner;
    let supply = mint.supply;
    let decimals = mint.decimals;

    // Check if this is an NFT (supply = 1 and decimals = 0)
    let is_nft = supply == 1 && decimals == 0;

    if is_nft {
        if let Some(metadata) = metadata {
            match metadata.token_standard {
                Some(
                    mpl_token_metadata::types::TokenStandard::NonFungible
                    | mpl_token_metadata::types::TokenStandard::NonFungibleEdition,
                ) => Ok(RewardType::LegacyNft),
                Some(
                    mpl_token_metadata::types::TokenStandard::ProgrammableNonFungible
                    | mpl_token_metadata::types::TokenStandard::ProgrammableNonFungibleEdition,
                ) => Ok(RewardType::ProgrammableNft),
                _ => Err(RewardError::UnsupportedAssetType.into()),
            }
        } else {
            Err(RewardError::MissingMetadataForProgrammableNft.into())
        }
    } else {
        // Token detection (SPL Token or Token 2022)
        require!(
            mint_owner == &token::ID || mint_owner == &token_interface::ID,
            RewardError::InvalidTokenProgramOwner
        );

        // Determine token type based on program owner
        if mint_owner == &token_interface::ID {
            Ok(RewardType::SplToken2022)
        } else {
            Ok(RewardType::SplToken)
        }
    }
}

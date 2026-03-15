use crate::errors::RewardError;
use crate::state::RewardType;
use anchor_lang::prelude::*;
use anchor_spl::metadata::{mpl_token_metadata, MetadataAccount};
use anchor_spl::token_interface::{Mint, TokenInterface};
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
    metadata: &Option<Account<MetadataAccount>>,
) -> Result<RewardType> {
    let mint_owner = mint.to_account_info().owner;
    let supply = mint.supply;
    let decimals = mint.decimals;

    msg!(
        "Detecting reward type - Supply: {}, Decimals: {}, Owner: {}",
        supply,
        decimals,
        mint_owner
    );

    // Check if this is an NFT (supply = 1 and decimals = 0)
    let is_nft = supply == 1 && decimals == 0;

    if is_nft {
        // NFT detection
        msg!("Detected as NFT (supply=1, decimals=0)");

        if let Some(metadata) = metadata {
            match metadata.token_standard {
                Some(
                    mpl_token_metadata::types::TokenStandard::NonFungible
                    | mpl_token_metadata::types::TokenStandard::NonFungibleEdition,
                ) => {
                    msg!("NFT type: NonFungible (Legacy NFT)");
                    Ok(RewardType::LegacyNft)
                }
                Some(
                    mpl_token_metadata::types::TokenStandard::ProgrammableNonFungible
                    | mpl_token_metadata::types::TokenStandard::ProgrammableNonFungibleEdition,
                ) => {
                    msg!("NFT type: ProgrammableNonFungible");
                    Ok(RewardType::ProgrammableNft)
                }
                _ => {
                    msg!("NFT has no token standard specified");
                    Err(RewardError::UnsupportedAssetType.into())
                }
            }
        } else {
            msg!("NFT detected but metadata account not provided");
            Err(RewardError::MissingMetadataForProgrammableNft.into())
        }
    } else {
        // Token detection (SPL Token or Token 2022)
        require!(
            mint_owner == &token::ID || mint_owner == &token::ID,
            RewardError::InvalidTokenProgramOwner
        );

        // Determine token type based on program owner
        if mint_owner == &token_interface::ID {
            msg!("Detected as Token 2022 (SPL Token 2022)");
            Ok(RewardType::SplToken2022)
        } else {
            msg!("Detected as SPL Token");
            Ok(RewardType::SplToken)
        }
    }
}

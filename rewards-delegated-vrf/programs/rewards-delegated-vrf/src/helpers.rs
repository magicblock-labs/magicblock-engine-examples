use crate::errors::RewardError;
use crate::state::{Reward, RewardType, RewardsList};
use anchor_lang::prelude::*;
use anchor_spl::metadata::mpl_token_metadata;
use anchor_spl::token_interface::{Mint, TokenAccount};
use anchor_spl::{token, token_interface};
use std::collections::HashSet;

pub fn detect_reward_type(
    mint: &InterfaceAccount<Mint>,
    metadata: &Option<mpl_token_metadata::accounts::Metadata>,
) -> Result<RewardType> {
    let mint_owner = mint.to_account_info().owner;
    let supply = mint.supply;
    let decimals = mint.decimals;

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
        require!(
            mint_owner == &token::ID || mint_owner == &token_interface::ID,
            RewardError::InvalidTokenProgramOwner
        );

        if mint_owner == &token_interface::ID {
            Ok(RewardType::SplToken2022)
        } else {
            Ok(RewardType::SplToken)
        }
    }
}

/// Validates individual reward state
pub fn validate_reward_state(reward: &Reward) -> Result<()> {
    // Check that draw_range_min <= draw_range_max
    if reward.draw_range_min > reward.draw_range_max {
        msg!(
            "Reward '{}' has invalid draw range: min ({}) > max ({})",
            reward.name,
            reward.draw_range_min,
            reward.draw_range_max
        );
        return Err(RewardError::InvalidDrawRange.into());
    }

    // Check that redemption_count <= redemption_limit
    if reward.redemption_count > reward.redemption_limit {
        msg!(
            "Reward '{}' has invalid state: redemption_count ({}) > redemption_limit ({})",
            reward.name,
            reward.redemption_count,
            reward.redemption_limit
        );
        return Err(RewardError::InvalidRedemptionState.into());
    }

    // Check that reward_amount is greater than 0
    if reward.reward_amount == 0 {
        msg!(
            "Reward '{}' has invalid reward_amount: must be greater than 0",
            reward.name
        );
        return Err(RewardError::InvalidRewardAmount.into());
    }

    Ok(())
}

/// Validates that reward ranges don't exceed global bounds and don't overlap
pub fn validate_reward(reward_list: &RewardsList) -> Result<()> {
    let rewards = &reward_list.rewards;
    let global_min = reward_list.global_range_min;
    let global_max = reward_list.global_range_max;
    let mut seen_names = HashSet::new();

    // Check each reward stays within global bounds
    for reward in rewards {
        // First validate individual reward state
        validate_reward_state(reward)?;

        // Reward names are treated as stable identifiers by the dashboard and
        // update/remove flows, so they must stay unique within a reward list.
        if !seen_names.insert(reward.name.as_str()) {
            return Err(RewardError::DuplicateRewardName.into());
        }

        if reward.draw_range_min < global_min || reward.draw_range_min > global_max {
            msg!(
                "Reward '{}' draw_range_min ({}) exceeds global bounds [{}, {}]",
                reward.name,
                reward.draw_range_min,
                global_min,
                global_max
            );
            return Err(RewardError::RewardRangeExceedsGlobalBounds.into());
        }
        if reward.draw_range_max < global_min || reward.draw_range_max > global_max {
            msg!(
                "Reward '{}' draw_range_max ({}) exceeds global bounds [{}, {}]",
                reward.name,
                reward.draw_range_max,
                global_min,
                global_max
            );
            return Err(RewardError::RewardRangeExceedsGlobalBounds.into());
        }
    }

    // Sort once and check adjacent ranges for overlap.
    let mut sorted_ranges: Vec<_> = rewards
        .iter()
        .map(|reward| {
            (
                reward.draw_range_min,
                reward.draw_range_max,
                reward.name.as_str(),
            )
        })
        .collect();
    sorted_ranges.sort_unstable_by_key(|(min, _, _)| *min);

    for pair in sorted_ranges.windows(2) {
        let (left_min, left_max, left_name) = pair[0];
        let (right_min, right_max, right_name) = pair[1];

        if left_max >= right_min {
            msg!(
                "Reward '{}' (range {}-{}) overlaps with '{}' (range {}-{})",
                left_name,
                left_min,
                left_max,
                right_name,
                right_min,
                right_max
            );
            return Err(RewardError::RewardRangesOverlap.into());
        }
    }

    Ok(())
}

pub fn remaining_redemptions(reward: &Reward) -> u64 {
    reward
        .redemption_limit
        .saturating_sub(reward.redemption_count)
}

pub fn required_inventory_in_base_units(
    reward_amount: u64,
    remaining_redemptions: u64,
    decimals: u8,
) -> Result<u64> {
    let multiplier = 10u64
        .checked_pow(decimals as u32)
        .ok_or(RewardError::ArithmeticOverflow)?;
    let reward_amount_in_base_units = reward_amount
        .checked_mul(multiplier)
        .ok_or(RewardError::ArithmeticOverflow)?;

    reward_amount_in_base_units
        .checked_mul(remaining_redemptions)
        .ok_or(RewardError::ArithmeticOverflow.into())
}

pub fn total_required_inventory_for_mint(
    rewards: &[Reward],
    mint: Pubkey,
    decimals: u8,
) -> Result<u64> {
    rewards
        .iter()
        .filter(|reward| reward.reward_mints.contains(&mint))
        .try_fold(0u64, |acc, reward| {
            let reward_required = required_inventory_in_base_units(
                reward.reward_amount,
                remaining_redemptions(reward),
                decimals,
            )?;
            acc.checked_add(reward_required)
                .ok_or(RewardError::ArithmeticOverflow.into())
        })
}

pub fn validate_reward_inventory(
    reward_list: &RewardsList,
    mint: Option<&InterfaceAccount<Mint>>,
    token_account: Option<&InterfaceAccount<TokenAccount>>,
) -> Result<()> {
    // NFT rewards consume from their remaining mint pool, while fungible rewards
    // share a token-account balance per mint.
    for reward in &reward_list.rewards {
        if matches!(
            reward.reward_type,
            RewardType::LegacyNft | RewardType::ProgrammableNft
        ) {
            let available_nfts = reward.reward_mints.len() as u64;
            let remaining_inventory = remaining_redemptions(reward);

            msg!(
                "NFT inventory check for reward '{}': required={}, available={}",
                reward.name,
                remaining_inventory,
                available_nfts
            );

            require!(
                available_nfts >= remaining_inventory,
                RewardError::InsufficientTokenBalanceForReward
            );
        }
    }

    // NFT-only validations can stop here. Fungible inventory checks require the
    // matching mint and distributor token account.
    let (mint, token_account) = match (mint, token_account) {
        (Some(mint), Some(token_account)) => (mint, token_account),
        _ => return Ok(()),
    };

    let mint_used_by_fungible_reward = reward_list.rewards.iter().any(|reward| {
        reward.reward_mints.contains(&mint.key())
            && matches!(reward.reward_type, RewardType::SplToken | RewardType::SplToken2022)
    });

    if !mint_used_by_fungible_reward {
        return Ok(());
    }

    let total_required_after_change =
        total_required_inventory_for_mint(&reward_list.rewards, mint.key(), mint.decimals)?;

    msg!(
        "Inventory check for mint {}: required={}, available={}, decimals={}",
        mint.key(),
        total_required_after_change,
        token_account.amount,
        mint.decimals
    );

    require!(
        token_account.amount >= total_required_after_change,
        RewardError::InsufficientTokenBalanceForReward
    );

    Ok(())
}

/// Removes duplicate pubkeys while preserving order
pub fn remove_duplicate_pubkeys(pubkeys: Vec<Pubkey>) -> Vec<Pubkey> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();

    for pubkey in pubkeys.into_iter() {
        if !seen.contains(&pubkey) {
            unique.push(pubkey);
            seen.insert(pubkey);
        }
    }

    unique
}

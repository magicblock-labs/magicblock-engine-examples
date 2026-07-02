use anchor_lang::prelude::*;

use crate::errors::RewardError;
use crate::helpers::{validate_reward, validate_reward_inventory};
use crate::state::RewardType;
use crate::UpdateReward;

pub fn update_reward(
    ctx: Context<UpdateReward>,
    current_reward_name: String,
    updated_reward_name: Option<String>,
    reward_amount: Option<u64>,
    draw_range_min: Option<u32>,
    draw_range_max: Option<u32>,
) -> Result<()> {
    let reward_list = &mut ctx.accounts.reward_list;
    let reward = reward_list
        .rewards
        .iter_mut()
        .find(|reward| reward.name == current_reward_name)
        .ok_or(RewardError::RewardNotFound)?;
    let reward_type = reward.reward_type.clone();

    // Only apply fields explicitly supplied by the caller. This keeps update
    // semantics aligned with the dashboard's "edit only what changed" flow.
    if let Some(updated_name) = updated_reward_name {
        reward.name = updated_name;
    }
    if let Some(updated_range_min) = draw_range_min {
        reward.draw_range_min = updated_range_min;
    }
    if let Some(updated_range_max) = draw_range_max {
        reward.draw_range_max = updated_range_max;
    }

    if matches!(
        reward.reward_type,
        RewardType::SplToken | RewardType::SplToken2022
    ) {
        if let Some(updated_amount) = reward_amount {
            reward.reward_amount = updated_amount;
        }
    }

    validate_reward(reward_list)?;
    match reward_type {
        RewardType::SplToken | RewardType::SplToken2022 => {
            // Fungible rewards must still prove the distributor holds enough
            // balance after the update is applied.
            let mint = ctx.accounts.mint.as_ref().ok_or(RewardError::MissingMint)?;
            let token_account = ctx
                .accounts
                .token_account
                .as_ref()
                .ok_or(RewardError::MissingMintAccountForReward)?;

            require!(
                token_account.owner == ctx.accounts.reward_distributor.key(),
                RewardError::TokenNotOwnedByDistributor
            );
            require!(
                token_account.mint == mint.key(),
                RewardError::InvalidTokenAccount
            );

            validate_reward_inventory(reward_list, Some(mint), Some(token_account))?;
        }
        RewardType::LegacyNft | RewardType::ProgrammableNft => {
            // NFT availability is derived from the reward's remaining mint pool.
            validate_reward_inventory(reward_list, None, None)?;
        }
        _ => {}
    }

    Ok(())
}

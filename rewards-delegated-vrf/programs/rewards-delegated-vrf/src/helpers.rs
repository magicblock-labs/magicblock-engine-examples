use crate::errors::RewardError;
use crate::state::{Reward, RewardsList};
use anchor_lang::prelude::*;
use std::collections::HashSet;

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

    // Check each reward stays within global bounds
    for reward in rewards {
        // First validate individual reward state
        validate_reward_state(reward)?;

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

    // Check for overlapping ranges
    for (i, reward1) in rewards.iter().enumerate() {
        for reward2 in rewards.iter().skip(i + 1) {
            // Check if ranges overlap
            if !(reward1.draw_range_max < reward2.draw_range_min
                || reward2.draw_range_max < reward1.draw_range_min)
            {
                msg!(
                    "Reward '{}' (range {}-{}) overlaps with '{}' (range {}-{})",
                    reward1.name,
                    reward1.draw_range_min,
                    reward1.draw_range_max,
                    reward2.name,
                    reward2.draw_range_min,
                    reward2.draw_range_max
                );
                return Err(RewardError::RewardRangesOverlap.into());
            }
        }
    }

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

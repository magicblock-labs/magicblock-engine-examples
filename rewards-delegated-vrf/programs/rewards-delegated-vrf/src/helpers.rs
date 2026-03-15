use anchor_lang::prelude::*;
use crate::errors::RewardError;
use crate::state::RewardsList;

/// Validates that reward ranges don't exceed global bounds and don't overlap
pub fn validate_reward_ranges(reward_list: &RewardsList) -> Result<()> {
    let rewards = &reward_list.rewards;
    let global_min = reward_list.global_range_min;
    let global_max = reward_list.global_range_max;

    // Check each reward stays within global bounds
    for reward in rewards {
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

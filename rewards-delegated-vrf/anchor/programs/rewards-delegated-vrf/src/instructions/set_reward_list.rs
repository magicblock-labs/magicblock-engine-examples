use anchor_lang::prelude::*;

use crate::helpers::validate_reward;
use crate::SetRewardList;

pub fn set_reward_list(
    ctx: Context<SetRewardList>,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
    global_range_min: Option<u32>,
    global_range_max: Option<u32>,
) -> Result<()> {
    msg!("Setting reward list: {:?}", ctx.accounts.reward_list.key());

    let reward_list = &mut ctx.accounts.reward_list;
    let is_uninitialized = reward_list.reward_distributor == Pubkey::default();

    if is_uninitialized {
        reward_list.rewards = Vec::new();
    }

    reward_list.reward_distributor = ctx.accounts.reward_distributor.key();
    reward_list.bump = ctx.bumps.reward_list;

    if let Some(start_timestamp) = start_timestamp {
        reward_list.start_timestamp = start_timestamp;
    }

    if let Some(end_timestamp) = end_timestamp {
        reward_list.end_timestamp = end_timestamp;
    }

    if let Some(global_range_min) = global_range_min {
        reward_list.global_range_min = global_range_min;
    }

    if let Some(global_range_max) = global_range_max {
        reward_list.global_range_max = global_range_max;
    }

    validate_reward(reward_list)?;

    Ok(())
}

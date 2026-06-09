use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::REWARD_LIST_SEED;
use crate::errors::RewardError;
use crate::state::RewardDistributor;
use crate::DelegateRewardList;

pub fn delegate_reward_list(ctx: Context<DelegateRewardList>) -> Result<()> {
    msg!(
        "Delegating reward list: {:?}",
        ctx.accounts.reward_list.key()
    );

    // This is done here instead in the Account struct to avoid the ownership check,
    // which can fail if the account is delegated.
    let distributor = RewardDistributor::try_deserialize(
        &mut &ctx.accounts.reward_distributor.data.borrow()[..],
    )?;
    require!(
        distributor.super_admin == ctx.accounts.admin.key()
            || distributor.admins.contains(&ctx.accounts.admin.key()),
        RewardError::Unauthorized
    );
    ctx.accounts.delegate_reward_list(
        &ctx.accounts.admin,
        &[
            REWARD_LIST_SEED,
            ctx.accounts.reward_distributor.key().as_ref(),
        ],
        DelegateConfig {
            validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}

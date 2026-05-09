use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::REWARD_LIST_SEED;
use crate::DelegateRewardList;

pub fn delegate_reward_list(ctx: Context<DelegateRewardList>) -> Result<()> {
    msg!(
        "Delegating reward list: {:?}",
        ctx.accounts.reward_list.key()
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

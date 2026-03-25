use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::UndelegateRewardList;

pub fn undelegate_reward_list(ctx: Context<UndelegateRewardList>) -> Result<()> {
    msg!(
        "Undelegating reward list: {:?}",
        ctx.accounts.reward_list.key()
    );
    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&ctx.accounts.reward_list.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;
    Ok(())
}

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::UndelegateRewardList;

pub fn undelegate_reward_list(ctx: Context<UndelegateRewardList>) -> Result<()> {
    msg!(
        "Undelegating reward list: {:?}",
        ctx.accounts.reward_list.key()
    );

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.reward_list.to_account_info()])
    .build_and_invoke()?;

    Ok(())
}

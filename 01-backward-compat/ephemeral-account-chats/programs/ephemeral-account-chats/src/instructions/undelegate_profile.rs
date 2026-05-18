use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::state::Profile;

pub fn undelegate_profile(ctx: Context<UndelegateProfile>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.profile.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"profile", profile.handle.as_bytes()],
        bump = profile.bump,
        has_one = authority,
    )]
    pub profile: Account<'info, Profile>,
}

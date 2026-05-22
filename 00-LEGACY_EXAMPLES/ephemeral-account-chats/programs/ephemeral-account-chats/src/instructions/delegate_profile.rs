use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;

use crate::state::Profile;

pub fn delegate_profile(ctx: Context<DelegateProfile>, validator: Option<Pubkey>) -> Result<()> {
    let profile_seeds: &[&[u8]] = &[b"profile", ctx.accounts.profile.handle.as_bytes()];
    let config = ephemeral_rollups_sdk::cpi::DelegateConfig {
        validator,
        ..Default::default()
    };

    ctx.accounts
        .delegate_profile(&ctx.accounts.authority, profile_seeds, config)?;

    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"profile", profile.handle.as_bytes()],
        bump = profile.bump,
        has_one = authority,
        del
    )]
    pub profile: Account<'info, Profile>,
}

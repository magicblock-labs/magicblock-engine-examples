use anchor_lang::prelude::*;

use crate::errors::ChatError;
use crate::state::{Profile, MAX_HANDLE_LEN};

pub fn create_profile(ctx: Context<CreateProfile>, handle: String) -> Result<()> {
    require!(
        !handle.is_empty() && handle.len() <= MAX_HANDLE_LEN,
        ChatError::InvalidHandle
    );

    let profile = &mut ctx.accounts.profile;
    profile.authority = ctx.accounts.authority.key();
    profile.bump = ctx.bumps.profile;
    profile.active_conversation_count = 0;
    profile.handle = handle;

    Ok(())
}

#[derive(Accounts)]
#[instruction(handle: String)]
pub struct CreateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Profile::INIT_SPACE,
        seeds = [b"profile", handle.as_bytes()],
        bump
    )]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}

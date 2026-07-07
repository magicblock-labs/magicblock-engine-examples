use anchor_lang::prelude::*;

use crate::errors::ChatError;
use crate::state::Profile;

pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
    require!(
        ctx.accounts.profile.active_conversation_count == 0,
        ChatError::ActiveConversationsExist
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        close = authority,
        seeds = [b"profile", profile.handle.as_bytes()],
        bump = profile.bump,
        has_one = authority
    )]
    pub profile: Account<'info, Profile>,
}

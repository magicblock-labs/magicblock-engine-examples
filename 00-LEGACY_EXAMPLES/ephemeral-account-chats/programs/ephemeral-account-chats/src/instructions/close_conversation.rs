use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral_accounts;

use crate::errors::ChatError;
use crate::state::Profile;

pub fn close_conversation(ctx: Context<CloseConversation>) -> Result<()> {
    let profile = &mut ctx.accounts.profile_owner;
    profile.active_conversation_count = profile
        .active_conversation_count
        .checked_sub(1)
        .ok_or(ChatError::ConversationCountUnderflow)?;

    ctx.accounts.close_ephemeral_conversation()?;

    Ok(())
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct CloseConversation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [b"profile", profile_owner.handle.as_bytes()],
        bump = profile_owner.bump,
        has_one = authority
    )]
    pub profile_owner: Account<'info, Profile>,
    #[account(
        seeds = [b"profile", profile_other.handle.as_bytes()],
        bump = profile_other.bump,
    )]
    pub profile_other: Account<'info, Profile>,
    /// CHECK: Ephemeral conversation PDA sponsored by the profile.
    #[account(
        mut,
        seeds = [
            b"conversation",
            profile_owner.handle.as_bytes(),
            profile_other.handle.as_bytes()
        ],
        eph,
        bump
    )]
    pub conversation: AccountInfo<'info>,
}

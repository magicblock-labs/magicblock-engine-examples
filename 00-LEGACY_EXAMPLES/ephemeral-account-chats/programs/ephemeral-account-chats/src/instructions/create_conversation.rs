use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral_accounts;

use crate::errors::ChatError;
use crate::state::{Conversation, Profile};

pub fn create_conversation(ctx: Context<CreateConversation>) -> Result<()> {
    let profile = &mut ctx.accounts.profile_owner;
    profile.active_conversation_count = profile
        .active_conversation_count
        .checked_add(1)
        .ok_or(ChatError::ConversationCountOverflow)?;

    ctx.accounts
        .create_ephemeral_conversation((8 + Conversation::space_for_message_count(0)) as u32)?;

    let conversation = Conversation {
        handle_owner: ctx.accounts.profile_owner.handle.clone(),
        handle_other: ctx.accounts.profile_other.handle.clone(),
        bump: ctx.bumps.conversation,
        messages: Vec::new(),
    };
    let mut data = ctx.accounts.conversation.try_borrow_mut_data()?;
    conversation.try_serialize(&mut &mut data[..])?;

    Ok(())
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct CreateConversation<'info> {
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
        eph,
        seeds = [b"conversation", profile_owner.handle.as_bytes(), profile_other.handle.as_bytes()],
        bump
    )]
    pub conversation: AccountInfo<'info>,
}

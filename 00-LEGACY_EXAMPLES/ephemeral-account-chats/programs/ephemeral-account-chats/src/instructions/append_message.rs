use anchor_lang::prelude::*;

use crate::errors::ChatError;
use crate::state::{Conversation, ConversationMessage, Profile, MAX_MESSAGE_LEN};

pub fn append_message(ctx: Context<AppendMessage>, body: String) -> Result<()> {
    require!(
        !body.is_empty() && body.len() <= MAX_MESSAGE_LEN,
        ChatError::InvalidMessage
    );

    let conversation = &mut ctx.accounts.conversation;
    require!(
        ctx.accounts.authority.key() == ctx.accounts.profile_owner.authority
            || ctx.accounts.authority.key() == ctx.accounts.profile_other.authority,
        ChatError::InvalidConversationOwner
    );

    let required_size = 8 + Conversation::space_for_message_count(conversation.messages.len() + 1);
    require!(
        conversation.to_account_info().data_len() >= required_size,
        ChatError::ConversationCapacityExceeded
    );

    conversation.messages.push(ConversationMessage {
        sender: ctx.accounts.authority.key(),
        body,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct AppendMessage<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"profile", profile_owner.handle.as_bytes()],
        bump = profile_owner.bump,
    )]
    pub profile_owner: Account<'info, Profile>,
    #[account(
        seeds = [b"profile", profile_other.handle.as_bytes()],
        bump = profile_other.bump,
    )]
    pub profile_other: Account<'info, Profile>,
    #[account(
        mut,
        seeds = [
            b"conversation",
            profile_owner.handle.as_bytes(),
            profile_other.handle.as_bytes()
        ],
        bump
    )]
    pub conversation: Account<'info, Conversation>,
}

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral_accounts;

use crate::errors::ChatError;
use crate::state::{Conversation, Profile};

pub fn extend_conversation(
    ctx: Context<ExtendConversation>,
    additional_messages: u32,
) -> Result<()> {
    require!(additional_messages > 0, ChatError::InvalidExtensionSize);

    let current_message_capacity =
        Conversation::message_capacity(ctx.accounts.conversation.to_account_info().data_len());

    let new_message_capacity = current_message_capacity + additional_messages as usize;
    ctx.accounts.resize_ephemeral_conversation(
        (8 + Conversation::space_for_message_count(new_message_capacity)) as u32,
    )?;

    Ok(())
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct ExtendConversation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [b"profile", profile_sender.handle.as_bytes()],
        bump = profile_sender.bump,
        has_one = authority
    )]
    pub profile_sender: Account<'info, Profile>,
    #[account(
        seeds = [b"profile", profile_other.handle.as_bytes()],
        bump = profile_other.bump,
    )]
    pub profile_other: Account<'info, Profile>,
    /// CHECK: Ephemeral conversation PDA sponsored by the profile.
    #[account(
        mut,
        eph,
        seeds = [
            b"conversation",
            profile_sender.handle.as_bytes(),
            profile_other.handle.as_bytes()
        ],
        bump
    )]
    pub conversation: AccountInfo<'info>,
}

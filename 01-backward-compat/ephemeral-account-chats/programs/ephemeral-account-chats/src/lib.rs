#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::{Conversation, ConversationMessage, Profile};

declare_id!("D781aD7RTUVeAU9SZDdCNciYJe8yDyZJs1JbFtHd8Urj");

#[ephemeral]
#[program]
pub mod ephemeral_account_chats {
    use super::*;

    pub fn create_profile(ctx: Context<CreateProfile>, handle: String) -> Result<()> {
        instructions::create_profile(ctx, handle)
    }

    pub fn top_up_profile(ctx: Context<TopUpProfile>, lamports: u64) -> Result<()> {
        instructions::top_up_profile(ctx, lamports)
    }

    pub fn create_conversation(ctx: Context<CreateConversation>) -> Result<()> {
        instructions::create_conversation(ctx)
    }

    pub fn extend_conversation(
        ctx: Context<ExtendConversation>,
        additional_messages: u32,
    ) -> Result<()> {
        instructions::extend_conversation(ctx, additional_messages)
    }

    pub fn append_message(ctx: Context<AppendMessage>, body: String) -> Result<()> {
        instructions::append_message(ctx, body)
    }

    pub fn delegate_profile(
        ctx: Context<DelegateProfile>,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::delegate_profile(ctx, validator)
    }

    pub fn undelegate_profile(ctx: Context<UndelegateProfile>) -> Result<()> {
        instructions::undelegate_profile(ctx)
    }

    pub fn close_conversation(ctx: Context<CloseConversation>) -> Result<()> {
        instructions::close_conversation(ctx)
    }

    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        instructions::close_profile(ctx)
    }
}

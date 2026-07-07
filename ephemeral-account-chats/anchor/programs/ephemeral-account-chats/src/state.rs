use anchor_lang::prelude::*;

pub const MAX_HANDLE_LEN: usize = 32;
pub const MAX_MESSAGE_LEN: usize = 280;

#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub authority: Pubkey,
    pub bump: u8,
    pub active_conversation_count: u64,
    #[max_len(MAX_HANDLE_LEN)]
    pub handle: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ConversationMessage {
    pub sender: Pubkey,
    #[max_len(MAX_MESSAGE_LEN)]
    pub body: String,
    pub timestamp: i64,
}

#[account]
pub struct Conversation {
    pub handle_owner: String,
    pub handle_other: String,
    pub bump: u8,
    pub messages: Vec<ConversationMessage>,
}

impl Conversation {
    pub const BASE_SPACE: usize = 1 + 3 * 4 + MAX_HANDLE_LEN * 2;

    pub fn space_for_message_count(message_count: usize) -> usize {
        Self::BASE_SPACE + (message_count * ConversationMessage::INIT_SPACE)
    }

    pub fn message_capacity(data_len: usize) -> usize {
        (data_len - 8 - Self::BASE_SPACE) / ConversationMessage::INIT_SPACE
    }
}

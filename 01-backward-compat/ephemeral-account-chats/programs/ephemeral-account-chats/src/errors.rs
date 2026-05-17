use anchor_lang::prelude::*;

#[error_code]
pub enum ChatError {
    #[msg("The provided handle is invalid.")]
    InvalidHandle,
    #[msg("The provided message body is invalid.")]
    InvalidMessage,
    #[msg("The profile conversation count overflowed.")]
    ConversationCountOverflow,
    #[msg("The profile conversation count underflowed.")]
    ConversationCountUnderflow,
    #[msg("The conversation owner does not match the signer.")]
    InvalidConversationOwner,
    #[msg("The conversation other does not match the expected account.")]
    InvalidConversationOther,
    #[msg("The conversation does not have enough allocated capacity for another message.")]
    ConversationCapacityExceeded,
    #[msg("The profile still has active conversations.")]
    ActiveConversationsExist,
    #[msg("The top up amount must be greater than zero.")]
    InvalidTopUpAmount,
    #[msg("The conversation extension amount must be greater than zero.")]
    InvalidExtensionSize,
}

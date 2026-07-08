use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("deadline must be in the future")]
    DeadlineInPast,
    #[msg("auction is not open")]
    AuctionClosed,
    #[msg("auction is not ended")]
    AuctionNotEnded,
    #[msg("too many bidders")]
    TooManyBidders,
    #[msg("missing bid account")]
    MissingBid,
    #[msg("invalid bid account")]
    InvalidBid,
    #[msg("winning bidder cannot claim a refund")]
    WinnerCannotRefund,
    #[msg("bid was already refunded")]
    AlreadyRefunded,
    #[msg("token account is not owned by the expected authority")]
    InvalidTokenOwner,
    #[msg("token account mint mismatch")]
    MintMismatch,
    #[msg("invalid bid escrow account")]
    InvalidBidEscrow,
    #[msg("duplicate bid account")]
    DuplicateBid,
    #[msg("not all bid accounts are closed")]
    UnclosedBids,
}

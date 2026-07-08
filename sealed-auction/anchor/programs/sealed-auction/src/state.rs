use anchor_lang::prelude::*;

pub const MAX_BIDDERS: usize = 5;

#[account]
pub struct Auction {
    pub auctioneer: Pubkey,
    pub auction_id: u64,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub lot_amount: u64,
    pub deadline_ts: i64,
    pub bid_count: u8,
    pub closed_bid_count: u8,
    pub highest_bid: u64,
    pub highest_bidder: Pubkey,
    pub status: AuctionStatus,
    pub lot_claimed: bool,
    pub bump: u8,
}

impl Auction {
    pub const LEN: usize = 32 + 8 + 32 + 32 + 8 + 8 + 1 + 1 + 8 + 32 + 1 + 1 + 1;
}

#[account]
pub struct Bid {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub bidder_index: u8,
    pub refunded: bool,
    pub escrow: Pubkey,
    pub bump: u8,
}

impl Bid {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 1 + 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuctionStatus {
    Open,
    Ended,
    Settled,
}

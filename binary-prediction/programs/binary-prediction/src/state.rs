use anchor_lang::prelude::*;

/// Pool configuration for this prediction market.
/// The Pool PDA owns pool token custody and signs payout transfers.
#[account]
pub struct Pool {
    pub mint: Pubkey,
    /// Pool token authority. This is the Pool PDA itself.
    pub authority: Pubkey,
    /// Oracle account accepted by betting and settlement instructions.
    pub price_feed: Pubkey,
    /// Pyth feed id validated inside the oracle price update account.
    pub price_feed_id: [u8; 32],
    /// How long a bet must stay open before it can be settled.
    pub bet_duration_seconds: i64,
    pub min_stake: u64,
    /// Payout multiplier in basis points.
    pub payout_bps: u64,
    pub bump: u8,
}

impl Pool {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1;
}

/// Per-user prediction state.
/// This account is delegated to the ER while the user is playing. It holds one
/// open bet at a time and is reset after settlement.
#[account]
pub struct Bet {
    pub open_price: i64,
    pub expiry_ts: i64,
    pub direction: Direction,
    pub stake: u64,
    pub is_open: bool,
}

impl Bet {
    pub const LEN: usize = 8 + 8 + 1 + 8 + 1;
}

/// Direction the user predicts the price will move.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
}

//! Account data for per-player VRF / random state.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Seed prefix for the player PDA: `[PLAYER_SEED, authority]`.
pub const PLAYER_SEED: &[u8] = b"player";

/// Borsh-serialized on-chain; first byte is a type tag for future account kinds.
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Eq, Clone, Copy)]
pub struct PlayerState {
    pub discriminator: u8,
    /// Last committed random value (e.g. from your VRF reveal step).
    pub random_value: u64,
    /// Canonical PDA bump (stored for signing with seeds in later instructions).
    pub bump: u8,
}

pub const DISCRIMINATOR_PLAYER: u8 = 1;

impl PlayerState {
    pub const LEN: usize = 1 + 8 + 1;

    pub fn new(bump: u8) -> Self {
        Self {
            discriminator: DISCRIMINATOR_PLAYER,
            random_value: 0,
            bump,
        }
    }
}

/// Derives the player PDA for `authority` under `program_id`.
pub fn find_player_pda(authority: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PLAYER_SEED, authority.as_ref()], program_id)
}

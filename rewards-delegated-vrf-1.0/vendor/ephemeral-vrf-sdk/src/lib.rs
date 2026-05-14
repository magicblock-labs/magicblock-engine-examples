#[cfg(feature = "anchor")]
pub mod anchor;
pub mod consts;
pub mod instructions;
pub mod pda;
pub mod rnd;
pub mod types;

pub const fn id() -> ::solana_program::pubkey::Pubkey {
    consts::VRF_PROGRAM_ID
}

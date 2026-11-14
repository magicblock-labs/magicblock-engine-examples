//! On-chain program crate root. The Solana runtime loads this library and calls into
//! `entrypoint::process_instruction` (see `entrypoint` module).
//!
//! VRF integration uses [`ephemeral_vrf_sdk`] (see `request_randomness` / `callback_consume_randomness`).
#![forbid(unsafe_code)]

use solana_program::declare_id;

pub mod entrypoint;
pub mod error;
pub mod instructions;
pub mod processor;
pub mod state;
pub mod vrf_lite;

pub use processor::VrfInstruction;

declare_id!("5hExoUW5SvPxTHTcz3ok117BoLa1TzzG6KZZfWD23DfD");

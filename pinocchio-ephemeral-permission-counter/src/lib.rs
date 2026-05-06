#![no_std]
#![allow(unexpected_cfgs)]

mod entrypoint;
mod processor;
mod state;

use solana_address::declare_id;

pub use crate::entrypoint::process_instruction;

declare_id!("AAWCg4eJHpdmUtM8Wz6Thm8FDi6C3vnMksf1pt2vfxhf");

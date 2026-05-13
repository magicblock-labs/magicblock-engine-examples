#![no_std]
#![allow(unexpected_cfgs)]

mod entrypoint;
mod processor;
mod state;

pub use crate::entrypoint::process_instruction;

solana_address::declare_id!("393Ryd4qXVSQPJe1XE1bkhgahmhyqqw2sKcojALKWgNp");

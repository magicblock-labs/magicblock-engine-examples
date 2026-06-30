#![no_std]
#![allow(unexpected_cfgs)]

mod entrypoint;
mod processor;
mod state;

pub use crate::entrypoint::process_instruction;

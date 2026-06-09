#![no_std]
#![allow(unexpected_cfgs)]

mod entrypoint;
mod processor;
mod state;

use pinocchio::address::declare_id;

pub use crate::entrypoint::process_instruction;

declare_id!("HnC8fttqjwXwG7aa6C2HBEmeKmdQYhWc9E1TereJnbJU");

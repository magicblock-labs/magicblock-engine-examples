#![no_std]
#![allow(unexpected_cfgs)]

mod entrypoint;
mod processor;
mod state;

use pinocchio::address::declare_id;

pub use crate::entrypoint::process_instruction;

declare_id!("8a4LRibLA74JCzJTvSzv4wL2CgKUxoAir51fjtdZzHiw");

// state.rs
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    program_pack::{Sealed},
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct Counter {
    pub count: u64,
}

impl Counter {
    pub const SIZE: usize = 8;
}


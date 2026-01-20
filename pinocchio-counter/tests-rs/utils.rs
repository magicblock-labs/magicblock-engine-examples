#![allow(dead_code)]

use solana_pubkey::Pubkey;

pub const PROGRAM: Pubkey = Pubkey::new_from_array([7u8; 32]);

pub const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
pub const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
pub const DELEGATE_COUNTER: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];

pub fn counter_pda(program_id: Pubkey, initializer: Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"counter", initializer.to_bytes().as_slice()],
        &program_id,
    )
}

pub fn read_counter(data: &[u8]) -> u64 {
    assert!(data.len() >= 8, "counter account data too small");
    let ptr = data.as_ptr() as *const u64;
    let aligned = (ptr as usize) % core::mem::align_of::<u64>() == 0;
    if aligned {
        unsafe { *ptr }
    } else {
        unsafe { core::ptr::read_unaligned(ptr) }
    }
}

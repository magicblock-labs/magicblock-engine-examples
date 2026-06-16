#![allow(dead_code)]

use ephemeral_rollups_pinocchio::acl::{
    consts::PERMISSION_PROGRAM_ID, pda::permission_pda_from_permissioned_account,
};
use ephemeral_rollups_pinocchio::pda::{
    delegate_buffer_pda_from_delegated_account_and_owner_program,
    delegation_metadata_pda_from_delegated_account, delegation_record_pda_from_delegated_account,
};
use pinocchio::Address;
use solana_pubkey::Pubkey;

pub const PROGRAM: Pubkey = Pubkey::new_from_array([7u8; 32]);

pub const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
pub const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
pub const DELEGATE_COUNTER: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];

pub fn initialize_counter_ix_data(bump: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&INITIALIZE_COUNTER);
    data.push(bump);
    data
}

pub fn increase_counter_ix_data(bump: u8, increase_by: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(17);
    data.extend_from_slice(&INCREASE_COUNTER);
    data.push(bump);
    data.extend_from_slice(&increase_by.to_le_bytes());
    data
}

pub fn delegate_counter_ix_data(bump: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&DELEGATE_COUNTER);
    data.push(bump);
    data
}

pub fn counter_pda(program_id: Pubkey, initializer: Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"counter", initializer.to_bytes().as_slice()],
        &program_id,
    )
}

pub fn permission_pda(counter_pda: Pubkey) -> Pubkey {
    let counter_address = Address::new_from_array(counter_pda.to_bytes());
    let permission_address = permission_pda_from_permissioned_account(&counter_address);
    Pubkey::new_from_array(*permission_address.as_array())
}

pub fn delegation_buffer_pda(counter_pda: Pubkey) -> Pubkey {
    let counter_address = Address::new_from_array(counter_pda.to_bytes());
    let owner_address = Address::new_from_array(PROGRAM.to_bytes());
    let buffer_address = delegate_buffer_pda_from_delegated_account_and_owner_program(
        &counter_address,
        &owner_address,
    );
    Pubkey::new_from_array(*buffer_address.as_array())
}

pub fn delegation_record_pda(counter_pda: Pubkey) -> Pubkey {
    let counter_address = Address::new_from_array(counter_pda.to_bytes());
    let record_address = delegation_record_pda_from_delegated_account(&counter_address);
    Pubkey::new_from_array(*record_address.as_array())
}

pub fn delegation_metadata_pda(counter_pda: Pubkey) -> Pubkey {
    let counter_address = Address::new_from_array(counter_pda.to_bytes());
    let metadata_address = delegation_metadata_pda_from_delegated_account(&counter_address);
    Pubkey::new_from_array(*metadata_address.as_array())
}

pub fn permission_program() -> Pubkey {
    Pubkey::new_from_array(*PERMISSION_PROGRAM_ID.as_array())
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

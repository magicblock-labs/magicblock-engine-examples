// import crates / libraries
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    msg,
    pubkey::Pubkey,
    entrypoint::ProgramResult,
};
use crate::processor;

// declare and export the program's entrypoint
entrypoint!(process_instruction);

// program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8]
) -> ProgramResult {
    // log a message to the blockchain
    msg!("Welcome to the Counter Program: {}", program_id);
    msg!(
        "process_instruction: Program {} is executed with {} account(s) and the following data={:?}",
        program_id,
        accounts.len(),
        _instruction_data
    );
    processor::process_instruction(program_id, accounts, _instruction_data)?;
    Ok(())
}
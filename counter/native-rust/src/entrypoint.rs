// import crates / libraries
use crate::processor;
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};

// declare and export the program's entrypoint
entrypoint!(process_instruction);

// program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Log a message indicating the program ID, number of accounts, and instruction data
    msg!(
        "process_instruction: Program {} is executed with {} account(s) and the following data={:?}",
        program_id,
        accounts.len(),
        _instruction_data
    );
    processor::process_instruction(program_id, accounts, _instruction_data)?;
    Ok(())
}

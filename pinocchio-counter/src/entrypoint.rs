use crate::processor::{
    process_commit, process_commit_and_undelegate, process_delegate, process_increase_counter,
    process_increment_commit, process_increment_undelegate, process_initialize_counter,
    process_undelegation_callback,
};
use core::{mem::MaybeUninit, slice::from_raw_parts};
use pinocchio::{
    entrypoint::deserialize, error::ProgramError, no_allocator, nostd_panic_handler, AccountView,
    Address, ProgramResult, MAX_TX_ACCOUNTS, SUCCESS,
};

// Do not allocate memory.
no_allocator!();
// Use the no_std panic handler.
nostd_panic_handler!();

#[no_mangle]
#[allow(clippy::arithmetic_side_effects)]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    const UNINIT: MaybeUninit<AccountView> = MaybeUninit::<AccountView>::uninit();
    let mut accounts = [UNINIT; { MAX_TX_ACCOUNTS }];

    let (program_id, count, instruction_data) = deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts);

    match process_instruction(
        &program_id,
        from_raw_parts(accounts.as_ptr() as _, count),
        instruction_data,
    ) {
        Ok(()) => SUCCESS,
        Err(error) => error.into(),
    }
}

/// Log an error.
#[cold]
fn log_error(_error: &ProgramError) {
    #[cfg(feature = "logging")]
    pinocchio_log::log!("Program error");
}

/// Process an instruction.
#[inline(always)]
pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let result = inner_process_instruction(program_id, accounts, instruction_data);
    result.inspect_err(log_error)
}

/// Process an instruction.
#[inline(always)]
pub(crate) fn inner_process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let discriminator = &instruction_data[..8];
    let payload = &instruction_data[8..];

    match discriminator {
        [0, 0, 0, 0, 0, 0, 0, 0] => process_initialize_counter(program_id, accounts),
        [1, 0, 0, 0, 0, 0, 0, 0] => {
            let increase_by = read_u64(payload)?;
            process_increase_counter(program_id, accounts, increase_by)
        }
        [2, 0, 0, 0, 0, 0, 0, 0] => process_delegate(program_id, accounts),
        [3, 0, 0, 0, 0, 0, 0, 0] => process_commit_and_undelegate(program_id, accounts),
        [4, 0, 0, 0, 0, 0, 0, 0] => process_commit(program_id, accounts),
        [5, 0, 0, 0, 0, 0, 0, 0] => {
            let increase_by = read_u64(payload)?;
            process_increment_commit(program_id, accounts, increase_by)
        }
        [6, 0, 0, 0, 0, 0, 0, 0] => {
            let increase_by = read_u64(payload)?;
            process_increment_undelegate(program_id, accounts, increase_by)
        }
        [196, 28, 41, 206, 48, 37, 51, 167] => {
            process_undelegation_callback(program_id, accounts, payload)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn read_u64(input: &[u8]) -> Result<u64, ProgramError> {
    if input.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&input[..8]);
    Ok(u64::from_le_bytes(bytes))
}

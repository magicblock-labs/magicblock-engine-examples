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

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum InstructionDiscriminator {
    InitializeCounter,
    IncreaseCounter,
    Delegate,
    CommitAndUndelegate,
    Commit,
    IncrementAndCommit,
    IncrementAndUndelegate,
    UndelegationCallback,
}

impl InstructionDiscriminator {
    const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    const DELEGATE: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];
    const COMMIT_AND_UNDELEGATE: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    const COMMIT: [u8; 8] = [4, 0, 0, 0, 0, 0, 0, 0];
    const INCREMENT_AND_COMMIT: [u8; 8] = [5, 0, 0, 0, 0, 0, 0, 0];
    const INCREMENT_AND_UNDELEGATE: [u8; 8] = [6, 0, 0, 0, 0, 0, 0, 0];
    // Undelegation callback called by the delegation program
    const UNDELEGATION_CALLBACK: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

    fn from_bytes(bytes: [u8; 8]) -> Result<Self, ProgramError> {
        match bytes {
            Self::INITIALIZE_COUNTER => Ok(Self::InitializeCounter),
            Self::INCREASE_COUNTER => Ok(Self::IncreaseCounter),
            Self::DELEGATE => Ok(Self::Delegate),
            Self::COMMIT_AND_UNDELEGATE => Ok(Self::CommitAndUndelegate),
            Self::COMMIT => Ok(Self::Commit),
            Self::INCREMENT_AND_COMMIT => Ok(Self::IncrementAndCommit),
            Self::INCREMENT_AND_UNDELEGATE => Ok(Self::IncrementAndUndelegate),
            Self::UNDELEGATION_CALLBACK => Ok(Self::UndelegationCallback),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

// Do not allocate memory.
no_allocator!();
// Use the no_std panic handler.
nostd_panic_handler!();

#[no_mangle]
#[allow(clippy::arithmetic_side_effects)]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    const UNINIT: MaybeUninit<AccountView> = MaybeUninit::<AccountView>::uninit();
    let mut accounts = [UNINIT; { MAX_TX_ACCOUNTS }];

    let (program_id, count, instruction_data) =
        deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts);

    match process_instruction(
        program_id,
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

    let discriminator: [u8; 8] = instruction_data[..8]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let discriminator = InstructionDiscriminator::from_bytes(discriminator)?;
    let payload = &instruction_data[8..];

    log_instruction(discriminator);

    match discriminator {
        InstructionDiscriminator::InitializeCounter => {
            let bump = read_u8(payload)?;
            process_initialize_counter(program_id, accounts, bump)
        }
        InstructionDiscriminator::IncreaseCounter => {
            let (bump, increase_by) = read_bump_and_u64(payload)?;
            process_increase_counter(program_id, accounts, bump, increase_by)
        }
        InstructionDiscriminator::Delegate => {
            let bump = read_u8(payload)?;
            process_delegate(program_id, accounts, bump)
        }
        InstructionDiscriminator::CommitAndUndelegate => {
            process_commit_and_undelegate(program_id, accounts)
        }
        InstructionDiscriminator::Commit => process_commit(program_id, accounts),
        InstructionDiscriminator::IncrementAndCommit => {
            let (bump, increase_by) = read_bump_and_u64(payload)?;
            process_increment_commit(program_id, accounts, bump, increase_by)
        }
        InstructionDiscriminator::IncrementAndUndelegate => {
            let (bump, increase_by) = read_bump_and_u64(payload)?;
            process_increment_undelegate(program_id, accounts, bump, increase_by)
        }
        InstructionDiscriminator::UndelegationCallback => {
            process_undelegation_callback(program_id, accounts, payload)
        }
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

fn read_u8(input: &[u8]) -> Result<u8, ProgramError> {
    if input.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(input[0])
}

fn read_bump_and_u64(input: &[u8]) -> Result<(u8, u64), ProgramError> {
    if input.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let bump = read_u8(input)?;
    let value = read_u64(&input[1..])?;
    Ok((bump, value))
}

#[allow(unused_variables)]
fn log_instruction(discriminator: InstructionDiscriminator) {
    #[cfg(feature = "logging")]
    {
        match discriminator {
            InstructionDiscriminator::InitializeCounter => {
                pinocchio_log::log!("InitializeCounter");
            }
            InstructionDiscriminator::IncreaseCounter => {
                pinocchio_log::log!("IncreaseCounter");
            }
            InstructionDiscriminator::Delegate => {
                pinocchio_log::log!("Delegate");
            }
            InstructionDiscriminator::CommitAndUndelegate => {
                pinocchio_log::log!("CommitAndUndelegate");
            }
            InstructionDiscriminator::Commit => {
                pinocchio_log::log!("Commit");
            }
            InstructionDiscriminator::IncrementAndCommit => {
                pinocchio_log::log!("IncrementAndCommit");
            }
            InstructionDiscriminator::IncrementAndUndelegate => {
                pinocchio_log::log!("IncrementAndUndelegate");
            }
            InstructionDiscriminator::UndelegationCallback => {
                pinocchio_log::log!("UndelegationCallback");
            }
        }
    }
}

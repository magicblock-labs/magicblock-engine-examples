use crate::processor::{
    process_close_permission, process_commit_and_undelegate, process_create_permission,
    process_delegate, process_increase_counter, process_initialize_counter,
    process_undelegation_callback, process_update_permission,
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
    CreatePermission,
    UpdatePermission,
    ClosePermission,
    UndelegationCallback,
}

impl InstructionDiscriminator {
    const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    const DELEGATE: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];
    const COMMIT_AND_UNDELEGATE: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    const CREATE_PERMISSION: [u8; 8] = [4, 0, 0, 0, 0, 0, 0, 0];
    const UPDATE_PERMISSION: [u8; 8] = [5, 0, 0, 0, 0, 0, 0, 0];
    const CLOSE_PERMISSION: [u8; 8] = [6, 0, 0, 0, 0, 0, 0, 0];
    // Undelegation callback called by the delegation program
    const UNDELEGATION_CALLBACK: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

    fn from_bytes(bytes: [u8; 8]) -> Result<Self, ProgramError> {
        match bytes {
            Self::INITIALIZE_COUNTER => Ok(Self::InitializeCounter),
            Self::INCREASE_COUNTER => Ok(Self::IncreaseCounter),
            Self::DELEGATE => Ok(Self::Delegate),
            Self::COMMIT_AND_UNDELEGATE => Ok(Self::CommitAndUndelegate),
            Self::CREATE_PERMISSION => Ok(Self::CreatePermission),
            Self::UPDATE_PERMISSION => Ok(Self::UpdatePermission),
            Self::CLOSE_PERMISSION => Ok(Self::ClosePermission),
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
    _program_id: &Address,
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
    let payload = instruction_data
        .get(8..)
        .ok_or(ProgramError::InvalidInstructionData)?;

    #[cfg(feature = "logging")]
    log_instruction(discriminator);

    match discriminator {
        InstructionDiscriminator::InitializeCounter => {
            let id = Address::new_from_array(
                payload
                    .get(..32)
                    .ok_or(ProgramError::InvalidInstructionData)?
                    .try_into()
                    .map_err(|_| ProgramError::InvalidInstructionData)?,
            );
            process_initialize_counter(accounts, &id)
        }
        InstructionDiscriminator::IncreaseCounter => {
            let increase_by = read_u64(payload)?;
            process_increase_counter(accounts, increase_by)
        }
        InstructionDiscriminator::Delegate => process_delegate(accounts),
        InstructionDiscriminator::CommitAndUndelegate => process_commit_and_undelegate(accounts),
        InstructionDiscriminator::CreatePermission => process_create_permission(accounts),
        InstructionDiscriminator::UpdatePermission => process_update_permission(accounts),
        InstructionDiscriminator::ClosePermission => process_close_permission(accounts),
        InstructionDiscriminator::UndelegationCallback => {
            process_undelegation_callback(accounts, payload)
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

#[allow(unused_variables)]
#[cfg(feature = "logging")]
fn log_instruction(discriminator: InstructionDiscriminator) {
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
        InstructionDiscriminator::CreatePermission => {
            pinocchio_log::log!("CreatePermission");
        }
        InstructionDiscriminator::UpdatePermission => {
            pinocchio_log::log!("UpdatePermission");
        }
        InstructionDiscriminator::ClosePermission => {
            pinocchio_log::log!("ClosePermission");
        }
        InstructionDiscriminator::UndelegationCallback => {
            pinocchio_log::log!("UndelegationCallback");
        }
    }
}

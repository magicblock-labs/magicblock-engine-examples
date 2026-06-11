use crate::processor::{
    process_callback_roll_dice, process_callback_undelegate_player, process_delegate_player,
    process_initialize, process_roll_dice, process_undelegate_player,
};
use core::{mem::MaybeUninit, slice::from_raw_parts};
use pinocchio::{
    entrypoint::deserialize, error::ProgramError, no_allocator, nostd_panic_handler, AccountView,
    Address, ProgramResult, MAX_TX_ACCOUNTS, SUCCESS,
};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum InstructionDiscriminator {
    Initialize,
    RollDice,
    CallbackRollDice,
    DelegatePlayer,
    UndelegatePlayer,
    CallbackUndelegatePlayer,
}

impl InstructionDiscriminator {
    const INITIALIZE: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    const ROLL_DICE: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    const CALLBACK_ROLL_DICE: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];
    const DELEGATE_PLAYER: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    const UNDELEGATE_PLAYER: [u8; 8] = [4, 0, 0, 0, 0, 0, 0, 0];
    const CALLBACK_UNDELEGATE_PLAYER: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

    pub fn from_bytes(bytes: [u8; 8]) -> Result<Self, ProgramError> {
        match bytes {
            Self::INITIALIZE => Ok(Self::Initialize),
            Self::ROLL_DICE => Ok(Self::RollDice),
            Self::CALLBACK_ROLL_DICE => Ok(Self::CallbackRollDice),
            Self::DELEGATE_PLAYER => Ok(Self::DelegatePlayer),
            Self::UNDELEGATE_PLAYER => Ok(Self::UndelegatePlayer),
            Self::CALLBACK_UNDELEGATE_PLAYER => Ok(Self::CallbackUndelegatePlayer),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }

    pub fn to_bytes(self) -> [u8; 8] {
        match self {
            Self::Initialize => Self::INITIALIZE,
            Self::RollDice => Self::ROLL_DICE,
            Self::CallbackRollDice => Self::CALLBACK_ROLL_DICE,
            Self::DelegatePlayer => Self::DELEGATE_PLAYER,
            Self::UndelegatePlayer => Self::UNDELEGATE_PLAYER,
            Self::CallbackUndelegatePlayer => Self::CALLBACK_UNDELEGATE_PLAYER,
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
        InstructionDiscriminator::Initialize => process_initialize(program_id, accounts),
        InstructionDiscriminator::RollDice => {
            let client_seed = read_u8(payload)?;
            process_roll_dice(program_id, accounts, client_seed)
        }
        InstructionDiscriminator::CallbackRollDice => {
            if payload.len() < 33 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let randomness = payload[..32]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            let client_seed = read_u8(&payload[32..])?;
            process_callback_roll_dice(accounts, randomness, client_seed)
        }
        InstructionDiscriminator::DelegatePlayer => process_delegate_player(program_id, accounts),
        InstructionDiscriminator::UndelegatePlayer => {
            process_undelegate_player(program_id, accounts)
        }
        InstructionDiscriminator::CallbackUndelegatePlayer => {
            process_callback_undelegate_player(program_id, accounts, payload)
        }
    }
    .inspect_err(log_error)
}

fn read_u8(input: &[u8]) -> Result<u8, ProgramError> {
    if input.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(input[0])
}

#[allow(unused_variables)]
fn log_instruction(discriminator: InstructionDiscriminator) {
    #[cfg(feature = "logging")]
    {
        match discriminator {
            InstructionDiscriminator::Initialize => {
                pinocchio_log::log!("Initialize");
            }
            InstructionDiscriminator::RollDice => {
                pinocchio_log::log!("RollDice");
            }
            InstructionDiscriminator::CallbackRollDice => {
                pinocchio_log::log!("CallbackRollDice");
            }
            InstructionDiscriminator::DelegatePlayer => {
                pinocchio_log::log!("DelegatePlayer");
            }
            InstructionDiscriminator::UndelegatePlayer => {
                pinocchio_log::log!("UndelegatePlayer");
            }
            InstructionDiscriminator::CallbackUndelegatePlayer => {
                pinocchio_log::log!("CallbackUndelegatePlayer");
            }
        }
    }
}

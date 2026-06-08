use crate::processor::{process_callback_roll_dice, process_initialize, process_roll_dice};
use core::{mem::MaybeUninit, slice::from_raw_parts};
use pinocchio::{
    entrypoint::deserialize, error::ProgramError, no_allocator, nostd_panic_handler, AccountView,
    ProgramResult, MAX_TX_ACCOUNTS, SUCCESS,
};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum InstructionDiscriminator {
    Initialize,
    RollDice,
    CallbackRollDice,
}

impl InstructionDiscriminator {
    const INITIALIZE: [u8; 8] = 0_u64.to_le_bytes();
    const ROLL_DICE: [u8; 8] = 1_u64.to_le_bytes();
    const CALLBACK_ROLL_DICE: [u8; 8] = 2_u64.to_le_bytes();

    pub fn from_bytes(bytes: [u8; 8]) -> Result<Self, ProgramError> {
        match bytes {
            Self::INITIALIZE => Ok(Self::Initialize),
            Self::ROLL_DICE => Ok(Self::RollDice),
            Self::CALLBACK_ROLL_DICE => Ok(Self::CallbackRollDice),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }

    pub fn to_bytes(self) -> [u8; 8] {
        match self {
            Self::Initialize => Self::INITIALIZE,
            Self::RollDice => Self::ROLL_DICE,
            Self::CallbackRollDice => Self::CALLBACK_ROLL_DICE,
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

    let (_program_id, count, instruction_data) =
        deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts);

    match process_instruction(
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
pub fn process_instruction(accounts: &[AccountView], instruction_data: &[u8]) -> ProgramResult {
    pinocchio_log::log!("Processing instruction: {}", instruction_data.len());
    pinocchio_log::log!("Processing discriminator: {}", &instruction_data[..8]);
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
        InstructionDiscriminator::Initialize => process_initialize(accounts),
        InstructionDiscriminator::RollDice => {
            let client_seed = read_u8(payload)?;
            process_roll_dice(accounts, client_seed)
        }
        InstructionDiscriminator::CallbackRollDice => {
            let randomness = payload[..32]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            let client_seed = read_u8(&payload[32..])?;
            process_callback_roll_dice(accounts, randomness, client_seed)
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
        }
    }
}

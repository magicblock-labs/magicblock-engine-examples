use crate::processor::{
    process_delegate, process_increase_counter, process_initialize_counter, process_undelegate,
    process_undelegation_callback,
};
use core::{mem::MaybeUninit, slice::from_raw_parts};
use ephemeral_rollups_pinocchio::compression::{
    CdpCompressedAccountMeta, CdpPackedAddressTreeInfo, CdpValidityProof,
};
use pinocchio::{
    entrypoint::deserialize, error::ProgramError, no_allocator, nostd_panic_handler, AccountView,
    Address, ProgramResult, MAX_TX_ACCOUNTS, SUCCESS,
};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum InstructionDiscriminator {
    InitializeCounter,
    IncreaseCounter,
    Delegate,
    Undelegate,
    UndelegationCallback,
}

impl InstructionDiscriminator {
    const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    const DELEGATE: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];
    const UNDELEGATE: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    // Undelegation callback called by the delegation program
    const UNDELEGATION_CALLBACK: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

    fn from_bytes(bytes: [u8; 8]) -> Result<Self, ProgramError> {
        match bytes {
            Self::INITIALIZE_COUNTER => Ok(Self::InitializeCounter),
            Self::INCREASE_COUNTER => Ok(Self::IncreaseCounter),
            Self::DELEGATE => Ok(Self::Delegate),
            Self::UNDELEGATE => Ok(Self::Undelegate),
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

    if program_id != &crate::ID {
        return ProgramError::IncorrectProgramId.into();
    }

    match process_instruction(
        from_raw_parts(accounts.as_ptr() as _, count),
        instruction_data,
    ) {
        Ok(()) => SUCCESS,
        Err(error) => error.into(),
    }
}

/// Process an instruction.
#[inline(always)]
pub fn process_instruction(accounts: &[AccountView], instruction_data: &[u8]) -> ProgramResult {
    pinocchio_log::log!(
        "Received {} bytes of instruction data",
        instruction_data.len()
    );
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
            // Parse payload
            let mut payload_index = 0;
            let id = Address::new_from_array(
                payload[payload_index..payload_index + 32]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidArgument)?,
            );
            payload_index += 32;
            pinocchio_log::log!("Read ID {}", payload_index);
            let (validity_proof, bytes_read) = CdpValidityProof::parse(&payload[payload_index..])?;
            payload_index += bytes_read;
            pinocchio_log::log!("Read Validity Proof {}", payload_index);
            let (address_tree_info, bytes_read) =
                CdpPackedAddressTreeInfo::parse(&payload[payload_index..])?;
            payload_index += bytes_read;
            pinocchio_log::log!("Read Address Tree Info {}", payload_index);
            let output_state_tree_index = payload[payload_index];
            pinocchio_log::log!("Read Output State Tree Index {}", payload_index);
            process_initialize_counter(
                accounts,
                id,
                validity_proof,
                address_tree_info,
                output_state_tree_index,
            )
        }
        InstructionDiscriminator::IncreaseCounter => {
            let increase_by = read_u64(payload)?;
            process_increase_counter(accounts, increase_by)
        }
        InstructionDiscriminator::Delegate => {
            let mut payload_index = 0;
            let (validity_proof, bytes_read) = CdpValidityProof::parse(&payload[payload_index..])?;
            payload_index += bytes_read;
            let (account_meta, _) = CdpCompressedAccountMeta::parse(&payload[payload_index..])?;
            process_delegate(accounts, validity_proof, account_meta)
        }
        InstructionDiscriminator::Undelegate => process_undelegate(accounts),
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
            InstructionDiscriminator::Undelegate => {
                pinocchio_log::log!("Undelegate");
            }
            InstructionDiscriminator::UndelegationCallback => {
                pinocchio_log::log!("UndelegationCallback");
            }
        }
    }
}

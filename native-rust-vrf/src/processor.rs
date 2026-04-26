use crate::{error::VrfError, instructions, vrf_lite};
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

/// Borsh-serialized instruction tag (lives with dispatch; no separate `instruction` module file).
///
/// The VRF **callback** is **not** encoded as this enum (see `vrf_lite`); it is `CALLBACK_…` + 32 bytes
/// and is routed in `process_instruction` before Borsh decode.
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Eq, Clone, Copy)]
pub enum VrfInstruction {
    /// Create the player PDA and zero the stored random (set it later from your VRF instruction).
    InitializePlayer,
    RequestRandomness { client_seed: u8 },
    /// Not used for `try_from_slice` (VRF uses `vrf_lite::CALLBACK_CONSUME_RANDOMNESS` + randomness). Kept for IDL / docs.
    #[allow(dead_code)]
    CallbackConsumeRandomness,
}

/// Decodes `instruction_data` and dispatches to the matching handler in `instructions/`.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if vrf_lite::is_vrf_callback_instruction(instruction_data) {
        return instructions::callback_consume_randomness::process(
            program_id,
            accounts,
            instruction_data,
        );
    }

    let ix = VrfInstruction::try_from_slice(instruction_data)
        .map_err(|_| VrfError::InvalidInstructionData)?;
    match ix {
        VrfInstruction::InitializePlayer => instructions::initialize_player::process(program_id, accounts)?,
        VrfInstruction::RequestRandomness { client_seed } => {
            instructions::request_randomness::process(program_id, accounts, client_seed)?
        }
        VrfInstruction::CallbackConsumeRandomness => {
            // Only reachable with malformed 40-byte Borsh that is not a valid VRF callback layout.
            return Err(VrfError::CallbackUnexpectedUserInvoke.into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod borsh_tests {
    use super::VrfInstruction;

    /// Keeps the TS `encodeRequestRandomnessInstruction` in sync with on-chain Borsh.
    #[test]
    fn request_randomness_bytes_match_ts_fixture() {
        let b = borsh::to_vec(&VrfInstruction::RequestRandomness { client_seed: 7 }).unwrap();
        assert_eq!(b, vec![1, 7], "if this fails, update test/utils borsh encoding");
    }
}


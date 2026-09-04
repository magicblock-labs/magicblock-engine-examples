use crate::{error::VrfError, state::PlayerState, vrf_lite};
use borsh::BorshDeserialize;
use ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY;
use ephemeral_vrf_sdk::rnd;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// `[0] vrf_program_identity` — `ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY`, **signer** (VRF)  
/// `[1] player` (mut) — the same PDA you passed in the request’s `accounts_metas`
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(VrfError::AccountOrder.into());
    }
    let vrf_id = &accounts[0];
    let player = &accounts[1];

    if vrf_id.key != &VRF_PROGRAM_IDENTITY {
        return Err(VrfError::InvalidVrfProgramIdentity.into());
    }
    if !vrf_id.is_signer {
        return Err(VrfError::InvalidVrfProgramIdentity.into());
    }

    let randomness: &[u8; 32] = vrf_lite::parse_vrf_callback_randomness(instruction_data)
        .map_err(|_| VrfError::InvalidCallbackData)?;

    if !player.is_writable {
        return Err(VrfError::AccountOrder.into());
    }
    if player.owner != program_id {
        return Err(VrfError::InvalidPlayerState.into());
    }

    let mut p = PlayerState::try_from_slice(&player.try_borrow_data()?).map_err(|_| {
        if player.data_is_empty() {
            VrfError::PlayerNotInitialized
        } else {
            VrfError::InvalidPlayerState
        }
    })?;
    if p.discriminator != crate::state::DISCRIMINATOR_PLAYER {
        return Err(VrfError::InvalidPlayerState.into());
    }

    // p.random_value = rnd::random_u64(randomness);
    let roll_1_to_6 = rnd::random_u8_with_range(randomness, 1, 6) as u64;
    p.random_value = roll_1_to_6;

    let out = borsh::to_vec(&p).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = player.try_borrow_mut_data()?;
    if out.len() > data.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..out.len()].copy_from_slice(&out);
    Ok(())
}

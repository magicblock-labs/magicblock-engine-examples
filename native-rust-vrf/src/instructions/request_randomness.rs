use crate::{error::VrfError, state, vrf_lite};
use ephemeral_vrf_sdk::{
    consts::{self, DEFAULT_QUEUE},
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    pubkey::Pubkey,
    sysvar,
};

/// Accounts (must match `ephemeral_vrf_sdk::create_request_randomness_ix` *invoke* list in order,
/// with one extra: your player PDA the callback will need — here passed so we can set
/// `accounts_metas` in the request; it is not part of the VRF `invoke` slice).
///
/// `[0] payer` (signer, mut) user paying for the VRF request  
/// `[1] program_identity` (not signer on the outer tx) PDA: seeds `[b"identity"]` under *this* program; we sign the CPI.  
/// `[2] oracle_queue` (mut) must be `ephemeral_vrf_sdk::consts::DEFAULT_QUEUE` on the cluster you use  
/// `[3] system program` (readonly)  
/// `[4] slot_hashes` (readonly) sysvar  
/// `[5] player` (mut) PDA for `[b"player", payer]` — also listed for the callback CPI  
/// Optional: `[6] vrf_program` (readonly) — not read by this handler; some clients pass it (Anchor) so
/// the VRF program is in the static account list for simulation/CPI.  
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    client_seed: u8,
) -> ProgramResult {
    if accounts.len() < 6 {
        return Err(VrfError::AccountOrder.into());
    }
    let payer = &accounts[0];
    let program_identity = &accounts[1];
    let oracle_queue = &accounts[2];
    let system_program = &accounts[3];
    let slot_hashes = &accounts[4];
    let player = &accounts[5];

    if !payer.is_signer {
        return Err(VrfError::MissingSignature.into());
    }
    if *oracle_queue.key != DEFAULT_QUEUE {
        return Err(VrfError::InvalidOracleQueue.into());
    }
    if !oracle_queue.is_writable {
        return Err(VrfError::AccountOrder.into());
    }
    if *system_program.key != solana_sdk_ids::system_program::ID {
        return Err(VrfError::InvalidSystemProgram.into());
    }
    if *slot_hashes.key != sysvar::slot_hashes::id() {
        return Err(VrfError::AccountOrder.into());
    }

    let (expected_identity, id_bump) = Pubkey::find_program_address(&[consts::IDENTITY], program_id);
    if program_identity.key != &expected_identity {
        return Err(VrfError::InvalidProgramIdentityPda.into());
    }
    if program_identity.is_writable {
        return Err(VrfError::AccountOrder.into());
    }

    let (expected_player, _) = state::find_player_pda(payer.key, program_id);
    if player.key != &expected_player {
        return Err(VrfError::InvalidPda.into());
    }
    if !player.is_writable {
        return Err(VrfError::AccountOrder.into());
    }
    if player.owner != program_id {
        return Err(VrfError::InvalidPlayerState.into());
    }
    {
        let d = player.try_borrow_data()?;
        if d.is_empty() || d[0] != state::DISCRIMINATOR_PLAYER {
            return Err(VrfError::PlayerNotInitialized.into());
        }
    }

    let params = RequestRandomnessParams {
        payer: *payer.key,
        oracle_queue: *oracle_queue.key,
        callback_program_id: *program_id,
        callback_discriminator: vrf_lite::CALLBACK_CONSUME_RANDOMNESS.to_vec(),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: *player.key,
            is_signer: false,
            is_writable: true,
        }]),
        caller_seed: [client_seed; 32],
        ..Default::default()
    };
    let vrf_ix = create_request_randomness_ix(params);

    let bump = [id_bump];
    let identity_signer: &[&[u8]] = &[consts::IDENTITY, &bump];

    invoke_signed(
        &vrf_ix,
        &[
            payer.clone(),
            program_identity.clone(),
            oracle_queue.clone(),
            system_program.clone(),
            slot_hashes.clone(),
        ],
        &[identity_signer],
    )?;

    Ok(())
}

use crate::{
    error::VrfError,
    state::{self, PlayerState},
};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_sdk_ids::system_program;
use solana_system_interface::instruction as system_instruction;


/// Accounts: `[0] player authority (signer, mut)`, `[1] player PDA (mut)`,
/// `[2] system program`.
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(VrfError::AccountOrder.into());
    }
    let authority = &accounts[0];
    let player_pda = &accounts[1];
    let system_info = &accounts[2];

    if !authority.is_signer {
        return Err(VrfError::MissingSignature.into());
    }
    if *system_info.key != system_program::ID {
        return Err(VrfError::InvalidSystemProgram.into());
    }
    if !player_pda.is_writable {
        return Err(VrfError::AccountOrder.into());
    }

    let (expected_pda, bump) = state::find_player_pda(authority.key, program_id);
    if player_pda.key != &expected_pda {
        return Err(VrfError::InvalidPda.into());
    }

    if player_pda.owner == program_id
        && player_pda.data_len() >= 1
        && player_pda.try_borrow_data()?[0] == state::DISCRIMINATOR_PLAYER
    {
        return Err(VrfError::AlreadyInitialized.into());
    }

    if player_pda.lamports() > 0
        && *player_pda.owner != system_program::ID
        && *player_pda.owner != *program_id
    {
        return Err(VrfError::ExpectedUnallocatedPda.into());
    }

    let space = PlayerState::LEN;
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);
    let player = PlayerState::new(bump);

    let bump_seed = [bump];
    let signer: &[&[u8]] = &[state::PLAYER_SEED, authority.key.as_ref(), &bump_seed];

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            player_pda.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[authority.clone(), player_pda.clone(), system_info.clone()],
        &[signer],
    )?;

    let data = borsh::to_vec(&player).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut dst = player_pda.try_borrow_mut_data()?;
    if data.len() > dst.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    dst[..data.len()].copy_from_slice(&data);
    msg!(
        "initialize_player: ok authority={} pda={}",
        authority.key,
        player_pda.key
    );
    Ok(())
}

use ephemeral_rollups_pinocchio::instruction::{undelegate, DelegateAccountCpiBuilder};
use ephemeral_rollups_pinocchio::intent_bundle::MagicIntentBundleBuilder;
use ephemeral_rollups_pinocchio::types::DelegateConfig;
use ephemeral_rollups_pinocchio::vrf::{
    program_identity_pda, random_u8_with_range, RequestRandomness, VRF_PROGRAM_IDENTITY,
};
use ephemeral_rollups_pinocchio::vrf::{RequestRandomnessCpi, IDENTITY_SEED};
use pinocchio::cpi::Seed;
use pinocchio::instruction::InstructionAccount;
use pinocchio::sysvars::rent::Rent;
use pinocchio::sysvars::Sysvar;
use pinocchio::{account::AccountView, cpi::Signer, error::ProgramError, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

use crate::entrypoint::InstructionDiscriminator;
use crate::state::Player;

const INTENT_BUNDLE_SIZE: usize = 512;

/// Create and initialize the counter PDA for the initializer.
pub fn process_initialize(accounts: &[AccountView]) -> ProgramResult {
    let [payer_account, player_account, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let player_pda = Player::find_pda(payer_account.address());

    if &player_pda.0 != player_account.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create counter account if it doesn't exist.
    if player_account.lamports() == 0 {
        let rent_exempt_lamports = Rent::get()?.try_minimum_balance(Player::SIZE)?;
        let bump_slice = &[player_pda.1];
        let seeds = Player::signer_seeds(payer_account.address(), bump_slice);
        let signer = Signer::from(&seeds);

        CreateAccount {
            from: payer_account,
            to: player_account,
            lamports: rent_exempt_lamports,
            space: Player::SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;
    }

    // Initialize counter to 0.
    let mut data = player_account.try_borrow_mut()?;
    let player = Player::load_mut(&mut data)?;
    player.last_result = 0;
    player.rollnum = 0;

    Ok(())
}

/// Increase the counter PDA by the requested amount.
pub fn process_roll_dice(accounts: &[AccountView], client_seed: u8) -> ProgramResult {
    let [payer, player, oracle_queue, program_identity, vrf_program, slot_hashes, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let player_pda = Player::find_pda(payer.address());
    if &player_pda.0 != player.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    let program_identity_pda = program_identity_pda(&crate::ID);
    if program_identity.address() != &program_identity_pda.0 {
        return Err(ProgramError::InvalidSeeds);
    }

    let bump_slice = &[program_identity_pda.1];
    let seeds = [Seed::from(IDENTITY_SEED), Seed::from(bump_slice)];
    let signer = Signer::from(&seeds);

    let mut data = [0_u8; RequestRandomness::serialized_size_for(8, 1, 1)];
    RequestRandomnessCpi {
        payer,
        oracle_queue,
        program_identity,
        vrf_program,
        slot_hashes,
        system_program,
        request: RequestRandomness {
            high_priority: true,
            caller_seed: [client_seed; 32],
            callback_discriminator: &InstructionDiscriminator::CallbackRollDice.to_bytes(),
            callback_args: &[client_seed],
            callback_program_id: crate::ID,
            callback_accounts_metas: &[InstructionAccount {
                address: player.address(),
                is_signer: false,
                is_writable: true,
            }],
        },
    }
    .invoke_signed(&mut data, &[signer])?;

    Ok(())
}

/// Delegate the player account to the delegation program.
pub fn process_callback_roll_dice(
    accounts: &[AccountView],
    randomness: [u8; 32],
    client_seed: u8,
) -> ProgramResult {
    let [program_identity, player] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if program_identity.address() != &VRF_PROGRAM_IDENTITY {
        return Err(ProgramError::InvalidSeeds);
    }

    let rnd_u8 = random_u8_with_range(&randomness, 1, 6);
    pinocchio_log::log!("Consuming random number: {}", rnd_u8);
    pinocchio_log::log!("client_seed={}", client_seed);

    let mut data = player.try_borrow_mut()?;
    let player = Player::load_mut(&mut data)?;
    player.last_result = rnd_u8;
    player.rollnum = player.rollnum.saturating_add(1);

    Ok(())
}

pub fn process_delegate_player(accounts: &[AccountView]) -> ProgramResult {
    let [payer, player, owner_program, buffer_acc, delegation_record, delegation_metadata, system_program, _delegation_program, validator] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let player_pda = Player::find_pda(payer.address());
    if &player_pda.0 != player.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    DelegateAccountCpiBuilder::new(
        payer,
        player,
        owner_program,
        buffer_acc,
        delegation_record,
        delegation_metadata,
        system_program,
    )
    .config(DelegateConfig {
        commit_frequency_ms: 0,
        validator: Some(*validator.address()),
    })
    .seeds(&Player::seeds(payer.address()))
    .bump(player_pda.1)
    .invoke()?;

    Ok(())
}

pub fn process_undelegate_player(accounts: &[AccountView]) -> ProgramResult {
    let [payer, player, magic_context, magic_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let player_pda = Player::find_pda(payer.address());
    if &player_pda.0 != player.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut data = [0_u8; INTENT_BUNDLE_SIZE];
    MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
        .commit_and_undelegate(&[player.clone()])
        .build_and_invoke(&mut data)
}

pub fn process_callback_undelegate_player(
    accounts: &[AccountView],
    ix_data: &[u8],
) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(delegated_acc, &crate::ID, buffer_acc, payer, ix_data)
}

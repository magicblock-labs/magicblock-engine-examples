use crate::state::Counter;
use ephemeral_rollups_pinocchio::acl::{
    data_buffer_size, CloseEphemeralPermission, CreateEphemeralPermission, EphemeralMembersArgs,
    Member, MemberFlags, UpdateEphemeralPermission, MAX_MEMBER_SIZE,
};
use ephemeral_rollups_pinocchio::instruction::delegate_account;
use ephemeral_rollups_pinocchio::instruction::{commit_and_undelegate_accounts, undelegate};
use ephemeral_rollups_pinocchio::types::DelegateConfig;
use pinocchio::sysvars::rent::Rent;
use pinocchio::sysvars::Sysvar;
use pinocchio::{
    account::AccountView,
    cpi::{Seed, Signer},
    error::ProgramError,
    Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

/// Create and initialize the counter PDA for the initializer.
pub fn process_initialize_counter(accounts: &[AccountView], id: &Address) -> ProgramResult {
    let [payer_info, counter_info, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (counter_pda, bump) = Counter::find_pda(id);
    if &counter_pda != counter_info.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    if counter_info.lamports() != 0 && counter_info.owned_by(&crate::ID) {
        // Idempotent
        return Ok(());
    }

    // Counter signer seeds
    let bump_seed = [bump];
    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(id.as_ref()),
        Seed::from(&bump_seed),
    ];

    // Signer with bump
    let signer = Signer::from(&seeds_array);

    // Create counter account if it doesn't exist.
    log!("Creating counter ...");
    let rent_exempt_lamports = Rent::get()?.try_minimum_balance(Counter::SIZE)?;
    // TODO: Use method from SDK
    let ephemeral_rent = (35 + 2 * MAX_MEMBER_SIZE as u64 + 60) * 32;
    log!("Rent exempt lamports: {}", rent_exempt_lamports);
    CreateAccount {
        from: payer_info,
        to: counter_info,
        lamports: rent_exempt_lamports + ephemeral_rent,
        space: Counter::SIZE as u64,
        owner: &crate::ID,
    }
    .invoke_signed(&[signer.clone()])?;
    log!("Counter created successfully");

    // Initialize counter to 0.
    let mut data = counter_info.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.bump = bump;
    counter_data.count = 0;
    counter_data.id = *id;

    Ok(())
}

/// Increase the counter PDA by the requested amount.
pub fn process_increase_counter(accounts: &[AccountView], increase_by: u64) -> ProgramResult {
    let [counter_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let mut data = counter_info.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    let counter_pda = Counter::derive_pda(&counter_data.id, &[counter_data.bump])?;

    if &counter_pda != counter_info.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    log!(
        "Increasing counter by {} from {} to {}",
        increase_by,
        counter_data.count,
        counter_data.count + increase_by
    );
    counter_data.count = counter_data
        .count
        .checked_add(increase_by)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}

/// Delegate the counter PDA to the delegation program.
pub fn process_delegate(accounts: &[AccountView]) -> ProgramResult {
    let [payer_info, counter_info, owner_program, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, system_program, rest @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let validator = rest.first().map(|account| *account.address());

    let (bump, id, counter_pda) = {
        let data = counter_info.try_borrow()?;
        let counter_data = Counter::load(&data)?;
        let counter_pda = Counter::derive_pda(&counter_data.id, &[counter_data.bump])?;
        (counter_data.bump, counter_data.id, counter_pda)
    };

    let seed_1 = b"counter";
    let seed_2 = id.as_ref();
    let seeds: &[&[u8]] = &[seed_1, seed_2];

    let delegate_config = DelegateConfig {
        validator,
        ..Default::default()
    };

    if &counter_pda != counter_info.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    delegate_account(
        &[
            payer_info,
            counter_info,
            owner_program,
            delegation_buffer,
            delegation_record,
            delegation_metadata,
            system_program,
        ],
        seeds,
        bump,
        delegate_config,
    )?;

    Ok(())
}

/// Commit the counter PDA state and undelegate it.
pub fn process_commit_and_undelegate(accounts: &[AccountView]) -> ProgramResult {
    let [payer_info, counter_info, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer_info.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    {
        let data = counter_info.try_borrow()?;
        let counter_data = Counter::load(&data)?;
        let counter_pda = Counter::derive_pda(&counter_data.id, &[counter_data.bump])?;

        if &counter_pda != counter_info.address() {
            return Err(ProgramError::InvalidSeeds);
        }
    }

    commit_and_undelegate_accounts(
        payer_info,
        &[counter_info.clone()],
        magic_context,
        magic_program,
        None,
        None,
    )?;

    Ok(())
}

/// Create a new permission for the counter PDA.
pub fn process_create_permission(accounts: &[AccountView]) -> ProgramResult {
    let [authority_info, counter_info, permission_program, permission_info, magic_program, vault_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (bump, id, counter_pda) = {
        let data = counter_info.try_borrow()?;
        let counter_data = Counter::load(&data)?;
        let counter_pda = Counter::derive_pda(&counter_data.id, &[counter_data.bump])?;
        (counter_data.bump, counter_data.id, counter_pda)
    };

    if &counter_pda != counter_info.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    let bump_seed = [bump];
    let seeds = [
        Seed::from(b"counter"),
        Seed::from(id.as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);

    CreateEphemeralPermission {
        payer: counter_info,
        permissioned_account: counter_info,
        permission: permission_info,
        permission_program: permission_program,
        magic_program: magic_program,
        vault: vault_info,
        args: EphemeralMembersArgs {
            members: &[Member {
                flags: MemberFlags::from_acl_flag_byte(
                    MemberFlags::AUTHORITY | MemberFlags::TX_LOGS,
                ),
                pubkey: *authority_info.address(),
            }],
            is_private: true,
        },
    }
    .invoke_signed::<{ data_buffer_size(1) }>(&[signer])?;

    Ok(())
}

/// Update the permission for the counter PDA.
pub fn process_update_permission(accounts: &[AccountView]) -> ProgramResult {
    let [payer_info, counter_info, permission_program, permission, magic_program, vault_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (bump, id, counter_pda) = {
        let data = counter_info.try_borrow()?;
        let counter_data = Counter::load(&data)?;
        let counter_pda = Counter::derive_pda(&counter_data.id, &[counter_data.bump])?;
        (counter_data.bump, counter_data.id, counter_pda)
    };

    if &counter_pda != counter_info.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    let bump_seed = [bump];
    let seeds = [
        Seed::from(b"counter"),
        Seed::from(id.as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);

    UpdateEphemeralPermission {
        authority: payer_info,
        authority_is_signer: true,
        payer: counter_info,
        permissioned_account: counter_info,
        permission: permission,
        permission_program: permission_program,
        magic_program: magic_program,
        vault: vault_info,
        args: EphemeralMembersArgs {
            members: &[],
            is_private: true,
        },
    }
    .invoke_signed::<{ data_buffer_size(0) }>(&[signer])?;

    Ok(())
}

/// Close the permission for the counter PDA.
pub fn process_close_permission(accounts: &[AccountView]) -> ProgramResult {
    let [payer_info, counter_info, permission_program, permission, magic_program, vault_info] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (bump, id, counter_pda) = {
        let data = counter_info.try_borrow()?;
        let counter_data = Counter::load(&data)?;
        let counter_pda = Counter::derive_pda(&counter_data.id, &[counter_data.bump])?;
        (counter_data.bump, counter_data.id, counter_pda)
    };

    if &counter_pda != counter_info.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    let bump_seed = [bump];
    let seeds = [
        Seed::from(b"counter"),
        Seed::from(id.as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);

    CloseEphemeralPermission {
        authority: payer_info,
        authority_is_signer: true,
        payer: counter_info,
        permissioned_account: counter_info,
        permission: permission,
        permission_program: permission_program,
        magic_program: magic_program,
        vault: vault_info,
    }
    .invoke_signed(&[signer])?;

    Ok(())
}

/// Handle the callback emitted by the delegation program on undelegation.
pub fn process_undelegation_callback(accounts: &[AccountView], ix_data: &[u8]) -> ProgramResult {
    let [counter_info, buffer_acc, payer_info, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(counter_info, &crate::ID, buffer_acc, payer_info, ix_data)?;
    Ok(())
}

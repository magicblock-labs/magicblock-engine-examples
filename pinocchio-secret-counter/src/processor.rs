use crate::state::Counter;
use ephemeral_rollups_pinocchio::acl::{
    commit_and_undelegate_permission, CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
    Member, MemberFlags, MembersArgs,
};
use ephemeral_rollups_pinocchio::instruction::delegate_account;
use ephemeral_rollups_pinocchio::instruction::{
    commit_accounts, commit_and_undelegate_accounts, undelegate,
};
use ephemeral_rollups_pinocchio::types::DelegateConfig;
use pinocchio::{
    account::AccountView,
    cpi::{Seed, Signer},
    error::ProgramError,
    Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

/// Derive the counter PDA from the caller-provided bump.
fn counter_address_from_bump(
    program_id: &Address,
    initializer: &AccountView,
    bump: u8,
) -> Result<Address, ProgramError> {
    let bump_seed = [bump];
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    {
        Address::create_program_address(
            &[b"counter", initializer.address().as_ref(), &bump_seed],
            program_id,
        )
        .map_err(|_| ProgramError::InvalidArgument)
    }
    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    {
        use solana_pubkey::Pubkey;
        let program_pubkey = Pubkey::new_from_array(*program_id.as_array());
        let initializer_pubkey = Pubkey::new_from_array(*initializer.address().as_array());
        let pda = Pubkey::create_program_address(
            &[b"counter", initializer_pubkey.as_ref(), &bump_seed],
            &program_pubkey,
        )
        .map_err(|_| ProgramError::InvalidArgument)?;
        Ok(Address::new_from_array(pda.to_bytes()))
    }
}

/// Create and initialize the counter PDA for the initializer.
pub fn process_initialize_counter(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [initializer_account, counter_account, system_program, permission_program, permission, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, validator] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let bump_seed = [bump];
    let counter_pda = counter_address_from_bump(program_id, initializer_account, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Counter signer seeds
    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(initializer_account.address().as_ref()),
        Seed::from(&bump_seed),
    ];

    // Signer with bump
    let signer = Signer::from(&seeds_array);

    // Create counter account if it doesn't exist.
    if counter_account.lamports() == 0 {
        log!("Creating counter ...");
        let rent_exempt_lamports = 1_000_000;

        let create_account_ix = CreateAccount {
            from: initializer_account,
            to: counter_account,
            lamports: rent_exempt_lamports,
            space: Counter::SIZE as u64,
            owner: program_id,
        };
        create_account_ix
            .invoke_signed(&[signer.clone()])
            .map_err(|_| {
                log!("Counter creation failed with error");
                ProgramError::Custom(100)
            })?;
        log!("Counter created successfully");
    }

    // Initialize counter to 0.
    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count = 0;

    // Create permission for the counter account if it doesn't already exist
    if permission.lamports() == 0 {
        log!("Creating permission ...");
        let members_array = [Member {
            flags: MemberFlags::default(),
            pubkey: *initializer_account.address(),
        }];
        let members_args = MembersArgs {
            members: Some(&members_array),
        };
        let result = CreatePermissionCpiBuilder::new(
            &counter_account,
            &permission,
            &initializer_account,
            &system_program,
            &permission_program.address(),
        )
        .members(members_args)
        .seeds(&[b"counter", initializer_account.address().as_ref()])
        .bump(bump)
        .invoke();

        result.map_err(|_| {
            log!("Permission creation failed with error");
            ProgramError::Custom(100)
        })?;
        log!("Permission created successfully");
    } else {
        log!("Permission account already exists, skipping creation");
    }

    // Delegate permisison if not delegated
    if unsafe { permission.owner() } == permission_program.address() {
        log!("Delegating permission");
        DelegatePermissionCpiBuilder::new(
            &initializer_account,
            &initializer_account,
            &counter_account,
            &permission,
            &system_program,
            &permission_program,
            &delegation_buffer,
            &delegation_record,
            &delegation_metadata,
            &_delegation_program,
            validator,
            permission_program.address(),
        )
        .signer_seeds(signer.clone())
        .invoke()
        .map_err(|_| {
            log!("Permission delegation failed");
            ProgramError::Custom(100)
        })?;
        log!("Permission delegated successfully");
    } else {
        log!("Permission already delegated");
    }

    // Verify permission was created and delegated before returning success
    if unsafe { permission.owner() } != permission_program.address() {
        log!("Permission was not properly delegated, failing instruction");
        return Err(ProgramError::Custom(3));
    }

    log!("Permission verified as created and delegated");
    Ok(())
}

/// Increase the counter PDA by the requested amount.
pub fn process_increase_counter(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [initializer_account, counter_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, initializer_account, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count = counter_data
        .count
        .checked_add(increase_by)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}

/// Delegate the counter PDA to the delegation program.
pub fn process_delegate(
    _program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [initializer, pda_to_delegate, owner_program, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, system_program, rest @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let validator = rest.first().map(|account| *account.address());
    let permission = rest.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let permission_program = rest.get(2).ok_or(ProgramError::NotEnoughAccountKeys)?;

    let seed_1 = b"counter";
    let seed_2 = initializer.address().as_ref();
    let seeds: &[&[u8]] = &[seed_1, seed_2];
    let counter_pda = counter_address_from_bump(owner_program.address(), initializer, bump)?;

    let delegate_config = DelegateConfig {
        validator,
        ..Default::default()
    };

    if counter_pda != *pda_to_delegate.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Verify permission was created and delegated before delegating counter
    log!("Checking permission delegation status");
    if unsafe { permission.owner() } != permission_program.address() {
        log!("Permission not delegated, cannot delegate counter");
        return Err(ProgramError::Custom(4));
    }
    log!("Permission verified as delegated, proceeding with counter delegation");

    delegate_account(
        &[
            initializer,
            pda_to_delegate,
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

/// Commit the counter PDA state to the base layer.
pub fn process_commit(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

/// Commit the counter PDA state and undelegate it.
pub fn process_commit_and_undelegate(
    _program_id: &Address,
    accounts: &[AccountView],
) -> ProgramResult {
    let [initializer, counter_account, permission_program, permission, magic_program, magic_context] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (counter_pda, bump_seed) =
        Address::find_program_address(&[b"counter", initializer.address().as_ref()], _program_id);

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Prepare signer seeds
    let seed_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(initializer.address().as_ref()),
        Seed::from(core::slice::from_ref(&bump_seed)),
    ];
    let signer_seeds = Signer::from(&seed_array);

    commit_and_undelegate_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    commit_and_undelegate_permission(
        &[
            initializer,
            counter_account,
            permission,
            magic_program,
            magic_context,
        ],
        permission_program.address(),
        true,
        true,
        Some(signer_seeds.clone()),
    )?;

    Ok(())
}

/// Increment the counter PDA and commit in a single instruction.
pub fn process_increment_commit(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, initializer, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count += increase_by;

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

/// Increment the counter PDA and commit+undelegate in a single instruction.
pub fn process_increment_undelegate(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, initializer, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count += increase_by;

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_and_undelegate_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

/// Handle the callback emitted by the delegation program on undelegation.
pub fn process_undelegation_callback(
    program_id: &Address,
    accounts: &[AccountView],
    ix_data: &[u8],
) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(delegated_acc, program_id, buffer_acc, payer, ix_data)?;
    Ok(())
}

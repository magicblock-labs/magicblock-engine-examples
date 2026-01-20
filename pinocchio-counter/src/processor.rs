use crate::state::Counter;
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
use pinocchio_system::instructions::CreateAccount;

pub fn process_initialize_counter(program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [initializer_account, counter_account, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (counter_pda, bump_seed) = Address::find_program_address(
        &[b"counter", initializer_account.address().as_ref()],
        program_id,
    );

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Create counter account if it doesn't exist
    if counter_account.lamports() == 0 {
        let rent_exempt_lamports = 1_000_000;

        let create_account_ix = CreateAccount {
            from: &initializer_account,
            to: &counter_account,
            lamports: rent_exempt_lamports,
            space: Counter::SIZE as u64,
            owner: program_id,
        };

        let seed_array: [Seed; 3] = [
            Seed::from(b"counter"),
            Seed::from(initializer_account.address().as_ref()),
            Seed::from(core::slice::from_ref(&bump_seed)),
        ];
        let signer = Signer::from(&seed_array);
        create_account_ix.invoke_signed(&[signer])?;
    }

    // Initialize counter to 0
    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count = 0;

    Ok(())
}

pub fn process_increase_counter(
    program_id: &Address,
    accounts: &[AccountView],
    increase_by: u64,
) -> ProgramResult {
    let [initializer_account, counter_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (counter_pda, _bump_seed) = Address::find_program_address(
        &[b"counter", initializer_account.address().as_ref()],
        program_id,
    );

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count += increase_by;

    Ok(())
}

pub fn process_delegate(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [initializer, pda_to_delegate, owner_program, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, system_program, rest @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let validator = rest.first().map(|account| *account.address());

    let seed_1 = b"counter";
    let seed_2 = initializer.address().as_ref();
    let seeds: &[&[u8]] = &[seed_1, seed_2];

    let delegate_config = DelegateConfig {
        validator: validator,
        ..Default::default()
    };

    let (_, bump) = Address::find_program_address(seeds, owner_program.address());

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

pub fn process_commit_and_undelegate(
    _program_id: &Address,
    accounts: &[AccountView],
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

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

pub fn process_increment_commit(
    program_id: &Address,
    accounts: &[AccountView],
    increase_by: u64,
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (counter_pda, _bump_seed) =
        Address::find_program_address(&[b"counter", initializer.address().as_ref()], program_id);

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

pub fn process_increment_undelegate(
    program_id: &Address,
    accounts: &[AccountView],
    increase_by: u64,
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (counter_pda, _bump_seed) =
        Address::find_program_address(&[b"counter", initializer.address().as_ref()], program_id);

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

pub fn process_undelegation_callback(
    program_id: &Address,
    accounts: &[AccountView],
    ix_data: &[u8],
) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    #[cfg(feature = "logging")]
    pinocchio_log::log!("Undelegating ...");
    undelegate(delegated_acc, program_id, buffer_acc, payer, &ix_data)?;
    Ok(())
}
